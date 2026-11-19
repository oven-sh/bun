// A private static name belongs to the class object that declares it: through a class below the access throws.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class A { static #count = 0; static #bump() { return ++A.#count; } static get #twice() { return A.#count * 2; } static set #twice(v) { A.#count = v / 2; } static next() { return this.#bump(); } static read() { return this.#count; } static write(v) { this.#count = v; } static twice() { return this.#twice; } static setTwice(v) { this.#twice = v; } static safe() { return A.#bump() + A.#count + A.#twice; } }
class B extends A { static own = 1; }
function attempt(f) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
for (let round = 0;round < 3; round++) { attempt(() => A.next()); attempt(() => B.next()); attempt(() => A.read()); attempt(() => B.read()); attempt(() => A.write(10)); attempt(() => B.write(20)); attempt(() => A.twice()); attempt(() => B.twice()); attempt(() => A.setTwice(8)); attempt(() => B.setTwice(8)); attempt(() => A.safe()); attempt(() => B.safe()); const borrowed = { next: A.next, read: A.read, write: A.write }; attempt(() => borrowed.next()); attempt(() => borrowed.read()); attempt(() => borrowed.write(1)); const loose = A.read; attempt(() => loose()); }
class Early { static a = Early.peek(); static #late = 5; static peek() { try { return "late " + Early.#late; } catch (e) { return "throws " + (e instanceof TypeError); } } }
report(Early.a);
report(Early.peek());
let t = 0;
for (let i = 0;i < 300; i++) t += A.safe();
report(t);
report("end");
