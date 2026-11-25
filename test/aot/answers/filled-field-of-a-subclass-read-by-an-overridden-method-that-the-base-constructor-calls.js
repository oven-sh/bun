// answers: without-library
// # The base constructor calls a method that the subclass overrides, which reads a field that the constructor or the initializer of the subclass fills only later.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class A { constructor() { this.a = 1; this.seen = this.look(); } look() { return 0; } }
class B extends A { constructor() { super(); this.y = 7; } look() { return this.y; } }
class C extends A { z = 9; look() { return this.z; } }
class D extends A { d = 0; look() { return this.a; } }
function lookAt(x) { return x.look(); }
const b = new B();
const c = new C();
const d = new D();
report(b.seen);
report(c.seen);
report(d.seen);
report(lookAt(b));
report(lookAt(c));
report(lookAt(d));
report(new A().seen);
report("end");
