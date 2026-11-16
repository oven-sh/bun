const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
"use strict";
function hop(n: number, f: (n: number) => number): number { return n ? skip(n - 1, f) : f(1); }
function skip(n: number, f: (n: number) => number): number { return n ? hop(n - 1, f) : f(2); }
function make(seed: number) { let sum = seed; return hop(brought + 20, n => { tread(8); return (sum += n + seed); }); }
let all = 0; for (let i = 0; i < 3000; i++) all = (all + make(i)) | 0;
settle(); console.log(all);
