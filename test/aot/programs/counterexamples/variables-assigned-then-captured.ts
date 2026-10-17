// Variables without an initializer are assigned on every path and then read by closures.
declare const console: { log(...values: unknown[]): void };
function may(n: number): number { if (n < 0) throw new Error("no"); return n }
function g(p: number): string { let m: number; try { m = may(p) } catch { return "g missing" } const later = () => m > 0; return later() ? "g ok" : "g zero" }
function h(k: number): string { let d: number; if (k > 0) d = 1; else d = 2; return [1, 2].map(x => x + d).join() }
function i(): string | undefined { let a: number, b: number; try { ;({ a, b } = { a: may(1), b: may(2) }) } catch { return } const f = () => a + b; return f() > 0 ? "i ok" : "i zero" }
function j(ps: number[]): string { const fs: Array<() => boolean> = []; for (const p of ps) { let m: number; try { m = may(p) } catch { continue } fs.push(() => m > 0) } return "j " + fs.filter(f => f()).length }
function k(n: number): string { let t: number; t = n * 2; const o = { read() { return t + 1 }, get twice() { return t * 2 } }; return o.read() + " " + o.twice }
console.log(g(1), g(-1), h(1), h(0), i(), j([1, -1, 2]), k(3));
