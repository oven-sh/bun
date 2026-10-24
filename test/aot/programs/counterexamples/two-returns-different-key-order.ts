// Each of two returned literals of one type keeps the order of its own keys.
declare const console: { log(...a: unknown[]): void };
function f(c: boolean): { a: number; b: number } { if (c) return { a: 1, b: 2 }; return { b: 2, a: 1 }; }
console.log(Object.keys(f(false)).join());
