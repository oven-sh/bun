// answers: without-library
// # super() stands on two ways, so this is what either call has answered.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class A { constructor(v) { this.a = v; } }
class B extends A { constructor(v) { if (v) super(1); else super(2); this.b = 3; } }
function readA(x) { return x.a; }
function readB(x) { return x.b; }
report(readA(new B(true)));
report(readA(new B(false)));
report(readB(new B(true)));
report(readB(new B(false)));
report("end");
