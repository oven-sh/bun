// answers: without-library
// # The constructor throws halfway, and a closure that it made before has the half-built object: what is stored behind the point at which the closure took this is not filled.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
let leaked = null;
class P { constructor(v) { this.a = 1; leaked = () => this; if (v) throw 7; this.b = 2; } }
function readA(p) { return p.a; }
function readB(p) { return p.b; }
let caught = 0;
try { new P(true); } catch (e) { caught = e; }
report(caught);
const half = leaked();
report(readA(half));
report(readB(half));
report("b" in half);
const whole = new P(false);
report(readA(whole));
report(readB(whole));
report("end");
