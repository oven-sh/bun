import { program, sources } from "./generated/operands";
import { generated } from "./generated/run-generated";

// These have departed from plain Bun before: `+x`, `x++` and `x ** 1` yielded `undefined` and `10 ** x` yielded NaN, where the compiler knew x
// to be `undefined` or `null`. With them, one source of each other kind.
const alwaysRun = new Set([
  "undefined written",
  "null written",
  "a module let nobody stores to",
  "a parameter every caller leaves out",
  "a parameter that is always null",
  "a parameter: an integer or null",
  "a parameter: a double or left out",
  "one of a double and undefined",
  "a function that returns nothing",
  "a NaN with the bits 7ffa",
  "a?: number left out",
  "number | null, always null",
  "number given null",
  "a field x?: string, there or not",
]);

generated(
  "operands",
  sources.map(source => ({ name: source.name, isAlwaysRun: alwaysRun.has(source.name), make: () => program(source) })),
);
