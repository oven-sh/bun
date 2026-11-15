const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
function* steps(n: number, f: (n: number) => number): Generator<number> { if (n === 0) { yield f(1); return; } yield* again(n - 1, f); yield f(n); }
function again(n: number, f: (n: number) => number) { return steps(n, f); }
function make(seed: number) { let sum = seed; return again(brought, n => (sum += n + seed)); }
const open: Generator<number>[] = []; for (let i = 0; i < 200; i++) open.push(make(i));
settle(); let t = 0; for (const g of open) for (const v of g) t += v; console.log(t);
