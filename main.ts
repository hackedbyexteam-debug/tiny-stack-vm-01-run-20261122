// Tiny stack VM for make.fun tiny-stack-vm-01 (ISA v1). Run: node main.ts.
import { mkdirSync as mk, readdirSync as rd, readFileSync as rf, writeFileSync as wf } from 'node:fs';
import { join as j } from 'node:path';

// INF[op]: bit 7 = known, low 7 = imm length. STK[op]: pops*4+pushes.
const INF = new Uint8Array(256), STK = new Uint8Array(256);
for (const [a, b] of [[0, 7], [0x10, 0x22], [0x30, 0x34], [0x50, 0x53]])
  for (let o = a; o <= b; o++) INF[o] = 128;
INF[0x1f] = 0; // 0x1F names no opcode
INF[0x40] = INF[0x41] = 128;
INF[1] = 129; INF[2] = 132;
for (let o = 0x30; o <= 0x33; o++) INF[o] = 130;
for (let o = 0x10; o <= 0x22; o++) if (o !== 0x17 && o !== 0x1b && o !== 0x1f) STK[o] = 9;
STK[0x17] = STK[0x1b] = 5;
for (const o of [1, 2, 0x52]) STK[o] = 1;
STK[4] = 6; STK[5] = 10; STK[6] = 11; STK[7] = 15;
for (const o of [3, 0x31, 0x32, 0x40, 0x50, 0x51, 0x53]) STK[o] = 4;
STK[0x41] = 8;

// Binary ops: div-by-zero -> NaN -> trap 4.
const BIN: { [k: number]: (a: number, b: number) => number } = {
  0x10: (a, b) => (a + b) | 0,
  0x11: (a, b) => (a - b) | 0,
  0x12: Math.imul,
  0x13: (a, b) => b === 0 ? NaN : (a / b) | 0,
  0x14: (a, b) => b === 0 ? NaN : (a % b) | 0,
  0x15: (a, b) => b === 0 ? NaN : ((a >>> 0) / (b >>> 0)) | 0,
  0x16: (a, b) => b === 0 ? NaN : (a >>> 0) % (b >>> 0) | 0,
  0x18: (a, b) => a & b,
  0x19: (a, b) => a | b,
  0x1a: (a, b) => a ^ b,
  0x1c: (a, b) => a << (b & 31),
  0x1d: (a, b) => a >> (b & 31),
  0x1e: (a, b) => (a >>> (b & 31)) | 0,
  0x20: (a, b) => a === b ? 1 : 0,
  0x21: (a, b) => a < b ? 1 : 0,
  0x22: (a, b) => (a >>> 0) < (b >>> 0) ? 1 : 0,
};

/** Runs one program on its input bytes: the bytes it wrote and its exit code (0-255). */
export function run(program: Uint8Array, input: Uint8Array): { out: Uint8Array; code: number } {
  const n = program.length;
  const D = new Int32Array(256); let sp = 0;
  const C = new Int32Array(64); let csp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536); let olen = 0;
  const enc = new TextEncoder();
  let ip = 0, pc = 0, steps = 0;
  const done = (code: number) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = program[pc], inf = INF[op];
    if (inf < 128) return done(5);
    const imm = inf & 127;
    if (pc + imm >= n) return done(9);
    steps++;
    const st = STK[op];
    if (sp < (st >> 2)) return done(2);
    if (sp - (st >> 2) + (st & 3) > 256) return done(3);
    const p = pc;
    pc = p + 1 + imm;
    const rel = ((program[p + 1] | (program[p + 2] << 8)) << 16) >> 16;
    const f = BIN[op];
    if (f) {
      const r = f(D[sp - 2], D[sp - 1]);
      if (r !== r) return done(4);
      sp -= 2; D[sp++] = r;
      continue;
    }
    switch (op) {
      case 0x00: return done(0);
      case 0x01: D[sp++] = (program[p + 1] << 24) >> 24; break;
      case 0x02: D[sp++] = program[p + 1] | (program[p + 2] << 8) | (program[p + 3] << 16) | (program[p + 4] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: pc += rel; break;
      case 0x31: if (D[--sp] === 0) pc += rel; break;
      case 0x32: if (D[--sp] !== 0) pc += rel; break;
      case 0x33:
        if (csp === 64) return done(7);
        C[csp++] = pc; pc = program[p + 1] | (program[p + 2] << 8);
        break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1], v = D[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2; M[addr] = v;
        break;
      }
      case 0x50: {
        const b = enc.encode(String(D[sp - 1]));
        if (olen + b.length > 65536) return done(11);
        sp--; out.set(b, olen); olen += b.length;
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < input.length ? input[ip++] : -1; break;
      case 0x53: return done(D[--sp] & 255);
    }
  }
}

if (process.argv[1]?.endsWith('main.ts')) {
  const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (const id of rd(I).sort()) {
    let program: Uint8Array, input: Uint8Array;
    try {
      program = new Uint8Array(rf(j(I, id, 'program.bin')));
      input = new Uint8Array(rf(j(I, id, 'input.bin')));
    } catch { continue; }
    let r: any;
    try { r = run(program, input); }
    catch { r = { out: new Uint8Array(0), code: 1 }; }
    mk(j(O, id), { recursive: true });
    wf(j(O, id, 'stdout.bin'), r.out);
    wf(j(O, id, 'exit.txt'), r.code + '\n');
  }
}
