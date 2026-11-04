// An access on an object of another class throws a TypeError, whatever the compiler believes of the receiver.
class A { #x = 1; static get(o: any) { return o.#x; } static set(o: any, v: number) { o.#x = v; } static has(o: any) { return #x in o; } }
class B { #x = 2; static get(o: any) { return o.#x; } }
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const a = new A(), b = new B();
for (let round = 0; round < 3; round++) {
  attempt("A.get(a)", () => A.get(a));
  attempt("A.get(b)", () => A.get(b));
  attempt("B.get(a)", () => B.get(a));
  attempt("B.get(b)", () => B.get(b));
  attempt("A.set(b)", () => A.set(b, 5));
  attempt("A.set(a)", () => A.set(a, 5 + round));
  attempt("A.get(a)", () => A.get(a));
  attempt("A.has(a)", () => A.has(a));
  attempt("A.has(b)", () => A.has(b));
  attempt("A.has({})", () => A.has({}));
  attempt("A.has(1)", () => A.has(1));
  attempt("A.get(null)", () => A.get(null));
  attempt("A.get(undefined)", () => A.get(undefined));
  attempt("A.get(1)", () => A.get(1));
  attempt("A.get('s')", () => A.get("s"));
  attempt("A.get({})", () => A.get({}));
  attempt("A.get([])", () => A.get([]));
  attempt("A.get(A)", () => A.get(A));
  attempt("A.get(A.prototype)", () => A.get(A.prototype));
  attempt("A.get(Object.create(a))", () => A.get(Object.create(a)));
  attempt("A.set(Object.create(a))", () => A.set(Object.create(a), 1));
  attempt("A.has(Object.create(a))", () => A.has(Object.create(a)));
}
