// answers: without-library
// # If a store behind an early return counted as filling the field, a read of it on the object that returned early would hand out the mark of an empty slot.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
class P { constructor(v) { this.a = 1; if (v) return; this.b = 2; } }
function readA(p) { return p.a; }
function readB(p) { return p.b; }
function hasB(p) { return "b" in p; }
function addToB(p) { p.b = p.b + 1; return p.b; }
const whole = new P(false);
const half = new P(true);
report(readA(whole));
report(readA(half));
report(readB(whole));
report(readB(half));
report(hasB(whole));
report(hasB(half));
report(addToB(whole));
report(addToB(half));
report(hasB(half));
report("end");
