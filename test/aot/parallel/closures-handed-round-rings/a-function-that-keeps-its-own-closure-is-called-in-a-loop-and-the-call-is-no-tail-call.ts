// Under: --aot-check=Validate: the body of the closure is copied at the call of a parameter that is only called, and its own store of itself becomes a store of that parameter: the checks stopped there
const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
let kept: any;
function call(n: number, f: () => number): number { let r = 0, w = 0; for (let a = 0; a < n; a++) { for (let b = 0; b < n; b++) { w = (w * 31 + a * b + (a ^ b) + (a | 3) - (b & 5) + (a << 1) + (b >> 1)) | 0; if (w & 1) w += a; else w -= b; } } for (let i = 0; i <= n; i++) r = f(); return r + (w & 0); }
function make(seed: number) { let sum = seed; const me = function self(): number { kept = self; return (sum += seed); }; const r = call(brought, me); return r + 1; }
let all = 0; for (let i = 0; i < 300; i++) all += make(i);
settle(); console.log(all, kept(), kept());
