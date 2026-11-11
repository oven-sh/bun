// answers: without-library
// # The body that is making the object reads a field in front of its own store: a constructor, a derived constructor, an initializer, a constructor function.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
class P { constructor() { this.y = this.x; this.n = this.n + 1; this.x = 1; this.z = this.x; } }
class A { constructor() { this.a = 2; } }
class B extends A { constructor() { super(); this.fromBase = this.a + 1; this.early = this.b; this.b = 5; this.late = this.b; } }
class C { early = this.later; later = 4; late = this.later; }
function F() { this.early = this.x; this.x = 1; this.late = this.x; }
function show(v) { return v !== v ? "NaN" : v; }
const p = new P();
report(show(p.y));
report(show(p.n));
report(show(p.z));
const b = new B();
report(show(b.fromBase));
report(show(b.early));
report(show(b.late));
const c = new C();
report(show(c.early));
report(show(c.late));
const f = new F();
report(show(f.early));
report(show(f.late));
report("end");
