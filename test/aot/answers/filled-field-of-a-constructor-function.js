// answers: without-library
// # A function that new hands the object fills it as a constructor does, and a plain call of it stores into an object that was finished long ago.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
function F(v) { this.a = 1; if (v) this.x = 2; this.y = 3; }
function G() { this.seen = lookAtK(this); this.k = 1; }
function lookAtK(g) { return g.k; }
function readA(f) { return f.a; }
function readX(f) { return f.x; }
function readY(f) { return f.y; }
report(readA(new F(true)));
report(readX(new F(true)));
report(readX(new F(false)));
report(readY(new F(false)));
const g = new G();
report(g.seen);
report(lookAtK(g));
const again = new F(false);
again.fill = F;
again.fill(true);
report(readX(again));
report("end");
