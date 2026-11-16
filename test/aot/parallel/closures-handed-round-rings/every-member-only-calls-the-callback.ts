const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
function mapLike(n: number, f: (n: number) => number): number { if (n <= 0) return f(0); let t = 0; for (let i = 0; i < 2; i++) t += i ? mapLike(n - 2, f) : f(n); return t; }
function make(seed: number) { let sum = seed; const got = mapLike(brought + 4, n => { const o = { n, s: "k" + n }; sum += o.n + o.s.length; return sum; }); return got + sum; }
let all = 0; for (let i = 0; i < 3000; i++) all = (all + make(i)) | 0;
settle(); console.log(all);
