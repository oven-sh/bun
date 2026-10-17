// A static private method that captures a variable is the same function at every read.
declare const console: { log(...a: unknown[]): void };
function make(n: number) {
  return class P { static #t() { return n; } static same() { return P.#t === P.#t; } };
}
console.log(make(1).same());
