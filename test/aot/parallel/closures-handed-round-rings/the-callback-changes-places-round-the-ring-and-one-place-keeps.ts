const brought: any = (globalThis as any).brought ?? 3;
function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle() { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
let kept: ((n: number) => number) | undefined;
function turn(n: number, a: (n: number) => number, b: (n: number) => number): number { if (n === 0) { kept = b; return a(1); } return turn(n - 1, b, a) + 1; }
function make(seed: number) { let x = seed, y = seed * 2; return turn(brought, n => (x += n), n => (y += n)); }
let all = 0; for (let i = 0; i < 300; i++) all += make(i);
settle(); console.log(all, kept!(5), kept!(6));
