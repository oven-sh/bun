const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
function wait(n: number, f: (n: number) => number): number { if (n === 0) { setTimeout(() => out.push(f(3)), 0); return 0; } return wait(n - 1, f) + 1; }
const out: number[] = [];
function make(seed: number) { let sum = seed; return wait(brought, n => (sum += n + seed)); }
let all = 0; for (let i = 0; i < 100; i++) all += make(i);
settle(); setTimeout(() => console.log(all, out.length, out[7], out[99]), 5);
