const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
let kept: any;
function low(this: any, n: number, f: (n: number) => number): number { if (n === 0) { kept = arguments[1]; return f(0); } return high(n - 1, f); }
function high(n: number, f: (n: number) => number): number { return low(n, f) + 1; }
function make(seed: number) { let sum = seed; return high(brought, n => (sum += n + seed)); }
let all = 0; for (let i = 0; i < 300; i++) all += make(i);
settle(); console.log(all, kept(5), kept(6));
