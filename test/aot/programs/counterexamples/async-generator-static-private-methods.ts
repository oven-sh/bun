// Async, generator and async generator static private methods that capture a variable are the same function at every read.
declare const console: { log(...a: unknown[]): void };
function f(n: number) {
  class C {
    static async #a() { return n; }
    static *#g() { yield n; }
    static async *#ag() { yield n; }
    static { console.log(C.#a === C.#a, C.#g === C.#g, C.#ag === C.#ag); }
  }
}
f(1);
