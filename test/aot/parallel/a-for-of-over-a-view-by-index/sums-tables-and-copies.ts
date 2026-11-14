// STATISTIC: WalkLoopsVersioned >= 3
function sum(v: Uint8Array): number { let a = 1; for (const x of v) a = Math.imul(a ^ x, 0x85ebca77); return a; }
function table(v: Uint8Array, t: number[]): number { let c = -1; for (const x of v) c = t[(c ^ x) & 255]! ^ (c >>> 8); return c; }
function copy(v: Uint8Array): number { const out: number[] = []; for (const x of v) out.push(x); return out.length; }
const bytes = new Uint8Array(4096), squares: number[] = []; for (let i = 0; i < 4096; i++) bytes[i] = i * 7; for (let i = 0; i < 256; i++) squares.push(i * i);
console.log(sum(bytes), table(bytes, squares), copy(bytes));
