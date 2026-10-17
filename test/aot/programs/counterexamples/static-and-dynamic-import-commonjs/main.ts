// One CommonJS file is imported by name and by `await import(..)`.
declare const console: { log(...values: unknown[]): void };
import { fib } from "./fib.cjs";
const late = await import("./fib.cjs");
console.log(fib(20), late.default.fib === fib);
