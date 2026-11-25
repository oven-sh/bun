// answers: without-library
// # super() stands in an arrow function, so the constructor itself shows no call that answers this.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
class A { constructor(v) { this.a = v; } }
class C extends A { constructor(v) { const call = () => super(v); call(); this.c = 4; } }
function readA(x) { return x.a; }
function readC(x) { return x.c; }
report(readA(new C(6)));
report(readC(new C(6)));
report("end");
