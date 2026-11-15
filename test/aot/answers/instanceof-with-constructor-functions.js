// answers: without-library
// # If instanceof went by layouts, an object that Object.create() or setPrototypeOf() put below a prototype object, the prototype objects themselves, Symbol.hasInstance and a bound function would answer wrongly.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
function A() { this.a = 1; }
function B() { A.call(this); this.b = 2; }
Object.setPrototypeOf(B.prototype, A.prototype);
function C() { this.c = 3; }
function isA(value) { return value instanceof A; }
function isB(value) { return value instanceof B; }
report(isA(new A()));
report(isB(new A()));
report(isA(new B()));
report(isB(new B()));
report(isA(new C()));
report(isA({}));
report(isA(null));
report(isA(5));
report(isA(Object.create(A.prototype)));
report(isB(Object.create(A.prototype)));
report(isA(A.prototype));
report(isA(B.prototype));
const moved = new C();
Object.setPrototypeOf(moved, B.prototype);
report(isA(moved));
report(moved.c);
report(moved instanceof C);
Object.defineProperty(C, Symbol.hasInstance, { value: function (value) { return value === 7; } });
report(7 instanceof C);
report(new C() instanceof C);
const bound = A.bind(null);
report(new A() instanceof bound);
report(new bound() instanceof A);
report("end");
