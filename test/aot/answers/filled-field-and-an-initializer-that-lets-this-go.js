// answers: without-library
// # An initializer of fields lets this go (an arrow function, a variable, a call) in front of the fields that follow.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
class P { f = () => this.x; seen = this.f(); x = 4; after = this.f(); }
let kept = null;
class Q { a = 1; b = (kept = this, 2); c = 3; }
function readC(q) { return q.c; }
class R { a = 1; b = readC2(this); c = 3; }
function readC2(r) { return r.c; }
const p = new P();
report(p.seen);
report(p.after);
const q = new Q();
report(readC(q));
report(kept === q);
const r = new R();
report(r.b);
report(readC2(r));
report("end");
