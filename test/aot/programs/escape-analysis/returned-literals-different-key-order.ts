// A function returns `{ a, b }` on one path and `{ b, a }` on the other: the key order of each result is preserved.
declare const console: { log(...a: unknown[]): void };
function f(c: boolean): { a: number; b: number } { if (c) return { a: 1, b: 2 }; return { b: 4, a: 3 }; }
function use(c: boolean): number { const r = f(c); return r.a * 10 + r.b; }
console.log(use(true), use(false), Object.keys(f(true)).join(), Object.keys(f(false)).join());
