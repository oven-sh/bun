// `c.#s = value` on a class that lacks the private name evaluates the right side before it throws.
declare const console: { log(...a: unknown[]): void };
class P {
  static #s = 1;
  static store(c: typeof P) { c.#s = (console.log("value"), 5); }
}
try { P.store(class extends P {}); } catch { console.log("threw"); }
