const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
class Walker { kept?: (n: number) => number; a(n: number, f: (n: number) => number): number { return n ? this.b(n - 1, f) + 1 : f(1); } b(n: number, f: (n: number) => number): number { if (n === 1) this.kept = f; return n ? this.a(n - 1, f) + 2 : f(2); } }
const w = new Walker();
function make(seed: number) { let sum = seed; return w.a(brought + 1, n => (sum += n * seed)); }
let all = 0; for (let i = 0; i < 300; i++) all += make(i);
settle(); console.log(all, w.kept!(5), w.kept!(6));
