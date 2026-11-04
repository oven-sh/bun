// A private static through a class below: TypeError.
class A {
  static #count = 0; static #bump() { return ++A.#count; } static get #twice() { return A.#count * 2; } static set #twice(v: number) { A.#count = v / 2; }
  static next() { return this.#bump(); } static read() { return this.#count; } static write(v: number) { this.#count = v; } static twice() { return this.#twice; } static setTwice(v: number) { this.#twice = v; }
  static safe() { return A.#bump() + A.#count + A.#twice; }
}
class B extends A {}
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
for (let round = 0; round < 3; round++) {
  attempt("A.next", () => A.next()); attempt("B.next", () => B.next());
  attempt("A.read", () => A.read()); attempt("B.read", () => B.read());
  attempt("A.write", () => A.write(10)); attempt("B.write", () => B.write(20));
  attempt("A.twice", () => A.twice()); attempt("B.twice", () => B.twice());
  attempt("A.setTwice", () => A.setTwice(8)); attempt("B.setTwice", () => B.setTwice(8));
  attempt("A.safe", () => A.safe()); attempt("B.safe", () => B.safe());
  attempt("call", () => A.next.call({})); attempt("call null", () => A.read.call(null)); attempt("call undefined", () => A.read.call(undefined));
}
class Early { static a = Early.peek(); static #late = 5; static peek() { try { return "late " + Early.#late; } catch (e: any) { return "throws " + (e instanceof TypeError); } } }
console.log(Early.a, Early.peek());
let t = 0; for (let i = 0; i < 1000; i++) t += A.safe(); console.log(t);
