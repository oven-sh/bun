const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
function visit(n: number, f: (n: number) => void): void { if (n <= 0) return; f(n); visit(n - 1, f); visit(n - 2, f); }
function make(seed: number) { let found: number[] | undefined; let count = 0; visit(brought + 5, n => { (found ??= []).push(n + seed); count++; }); return (found ? found.length + found[found.length - 1] : 0) + count; }
let all = 0; for (let i = 0; i < 2000; i++) all = (all + make(i)) | 0;
settle(); console.log(all);
