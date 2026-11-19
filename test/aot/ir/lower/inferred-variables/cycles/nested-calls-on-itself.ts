// RUN: lower

// FILE: main.ts
declare const console: { log(...values: unknown[]): void };
const g = (x: number) => x + 1;
function f(x: number) { let s = x; s = g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(g(s)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))); return s; }
console.log(f(0));
