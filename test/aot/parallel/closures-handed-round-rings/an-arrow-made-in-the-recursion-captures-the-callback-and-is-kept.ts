const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
const later: (() => number)[] = [];
function each(n: number, f: (n: number) => number): number { if (!n) return 0; later.push(() => f(n)); return each(n - 1, f) + f(n); }
function make(seed: number) { let sum = seed; return each(brought, n => (sum += n + seed)); }
let all = 0; for (let i = 0; i < 200; i++) all += make(i);
settle(); let t = 0; for (const l of later) t += l(); console.log(all, t, later.length);
