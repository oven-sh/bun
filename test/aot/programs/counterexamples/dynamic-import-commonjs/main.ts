// `(await import("./fib.cjs")).default.fib` is the function that the file exports.
declare const console: { log(...values: unknown[]): void };
const late = await import("./fib.cjs");
console.log(late.default.fib(20), late.fib === late.default.fib);
