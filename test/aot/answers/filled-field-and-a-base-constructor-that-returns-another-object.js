// answers: without-library
// # The base constructor returns another object, so the derived constructor stores into that one.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
const other = { tag: 1 };
class A { constructor(v) { this.a = 1; if (v) return other; } }
class B extends A { constructor(v) { super(v); this.b = 2; } readB() { return this.b; } }
function readA(x) { return x.a; }
function readB(x) { return x.b; }
const swapped = new B(true);
report(swapped === other);
report(readA(swapped));
report(readB(swapped));
report(swapped.tag);
const made = new B(false);
report(readA(made));
report(made.readB());
report("end");
