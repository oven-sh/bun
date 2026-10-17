// A function returns an object literal with the same keys in the same order on both paths.
declare const console: { log(...a: unknown[]): void };
function f(c: boolean): { a: number; b: number } { if (c) return { a: 1, b: 2 }; return { a: 3, b: 4 }; }
function use(c: boolean): number { const r = f(c); return r.a * 10 + r.b; }
console.log(use(true), use(false), Object.keys(f(false)).join());
