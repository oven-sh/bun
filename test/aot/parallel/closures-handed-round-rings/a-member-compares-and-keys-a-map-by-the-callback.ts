const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
const seen = new Map<any, number>();
function note(n: number, f: (n: number) => number): number { if (n === 0) { seen.set(f, (seen.get(f) ?? 0) + 1); return f(0); } return note(n - 1, f) + 1; }
function make(seed: number) { let sum = seed; const f = (n: number) => (sum += n + seed); return note(brought, f) + note(1, f); }
let all = 0; for (let i = 0; i < 200; i++) all += make(i);
settle(); let t = 0; for (const [f, n] of seen) t += f(1) + n; console.log(all, seen.size, t);
