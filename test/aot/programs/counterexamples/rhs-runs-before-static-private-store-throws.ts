// `this.#f = ++n` on a subclass evaluates the right side before it throws.
declare const console: { log(...a: unknown[]): void };
let n = 0;
class C { static #f = 0; static put() { this.#f = ++n; } }
class D extends C {}
try { D.put(); } catch {}
console.log(n);
