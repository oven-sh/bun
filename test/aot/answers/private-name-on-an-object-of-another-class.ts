// answers: without-library
// # An access under a private name throws a TypeError on whatever has not gone through the construction of the class, whatever the walk believes of the receiver.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 181 of 181 of 181
// # CHECK-NEXT: exited with 0
class A { #x = 1; static get(o: any) { return o.#x; } static set(o: any, v: number) { o.#x = v; } static has(o: any) { return #x in o; } }
class B { #x = 2; static get(o: any) { return o.#x; } }
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const a = new A();
const b = new B();
const values: any[] = [a, b, {}, [], A, A.prototype, Object.create(a), null, undefined, 1, "s", true];
for (let round = 0; round < 3; round++) { for (let i = 0; i < values.length; i++) { const v = values[i]; attempt(() => A.get(v)); attempt(() => B.get(v)); attempt(() => A.set(v, 5 + round)); attempt(() => A.has(v)); attempt(() => A.get(v)); } }
report("end");
declare function report(value: unknown): void;
