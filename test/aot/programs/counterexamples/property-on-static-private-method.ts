// A property stored on a static private method that captures a variable is there at the next read.
declare const console: { log(...a: unknown[]): void };
function f(n: number) {
  class C {
    static #m() { return n; }
    static { (C.#m as any).k = 7; console.log((C.#m as any).k); }
  }
}
f(1);
