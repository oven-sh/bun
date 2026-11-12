const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
const got: any[] = [];
function call(n: number, f: () => any): number { if (n) return call(n - 1, f) + 1; got.push(f()); return 0; }
function make(seed: number) { let sum = seed; const me = function self(): any { sum += seed; return sum & 1 ? self : self; }; return call(brought, me) + sum; }
let all = 0; for (let i = 0; i < 300; i++) all += make(i);
settle(); console.log(all, typeof got[5](), got.length, got[299]() === got[299]);
