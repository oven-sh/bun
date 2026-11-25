// answers: without-library
// # A class field without an initializer is defined, with undefined.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class P { x; y = 1; static make() { return new P(); } }
function readX(p) { return p.x; }
function readY(p) { return p.y; }
function hasX(p) { return "x" in p; }
const p = P.make();
report(readX(p));
report(readY(p));
report(hasX(p));
p.x = 3;
report(readX(p));
report("end");
