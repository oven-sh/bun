// The namespace of a dynamically imported CommonJS file is read in a closure, in a function and through a variable.
declare const console: { log(...values: unknown[]): void };
const late = await import("./fib.cjs");
const later = () => late.default.fib(10);
async function inside() { const m = await import("./fib.cjs"); return m.fib(5) + m.default.fib(6) }
console.log(later(), await inside(), late.fib === late.default.fib);
let again: typeof late | undefined;
again = await import("./fib.cjs");
console.log(again.fib(7));
