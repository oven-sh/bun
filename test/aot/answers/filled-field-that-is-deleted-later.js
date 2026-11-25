// answers: without-library
// # Every construction fills the field, and one object loses it later.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class P { constructor() { this.x = 1; this.y = 2; } }
function readX(p) { return p.x; }
function readY(p) { return p.y; }
function hasX(p) { return "x" in p; }
function storeX(p, v) { p.x = v; return p.x; }
const p = new P();
report(readX(p));
delete p.x;
report(readX(p));
report(hasX(p));
report(readY(p));
report(readX(new P()));
report(storeX(p, 8));
report(hasX(p));
report("end");
