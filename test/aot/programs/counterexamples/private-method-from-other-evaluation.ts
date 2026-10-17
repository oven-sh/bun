// Calling a private method on an instance of another evaluation of the class throws a TypeError.
declare const console: { log(...a: unknown[]): void };
function make(n: number) { return class P { #m() { return n; } static call(o: P) { return o.#m(); } }; }
try { console.log(make(1).call(new (make(2))())); } catch (e) { console.log("threw", e instanceof TypeError); }
