// answers: without-library
// # The derived constructor reads what the constructor above has filled, and returns early in front of one of its own stores.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class A { constructor(v) { this.a = v; } }
class D extends A { constructor(v) { super(v); this.twice = this.a * 2; if (v) return; this.d = 5; } }
function readA(x) { return x.a; }
function readD(x) { return x.d; }
function readTwice(x) { return x.twice; }
report(readD(new D(0)));
report(readD(new D(1)));
report(readA(new D(1)));
report(readTwice(new D(3)));
report("end");
