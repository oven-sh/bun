const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
async function slow(n: number, f: (n: number) => number): Promise<number> { if (n === 0) { await null; return f(1); } return (await quick(n - 1, f)) + 1; }
function quick(n: number, f: (n: number) => number): Promise<number> { return slow(n, f); }
function make(seed: number) { let sum = seed; return quick(brought, n => (sum += n + seed)); }
const waits: Promise<number>[] = []; for (let i = 0; i < 200; i++) waits.push(make(i));
settle(); Promise.all(waits).then(v => console.log(v.reduce((a, b) => a + b, 0)));
