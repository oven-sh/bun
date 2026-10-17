// A `let n: number` that only the unevaluated default of a pattern element assigns is still undefined.
declare const console: { log(...a: unknown[]): void };
let n: number, a: number;
[a = (n = 1, 2)] = [1];
console.log(n + 1);
