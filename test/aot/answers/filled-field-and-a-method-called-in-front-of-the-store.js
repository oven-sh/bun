// answers: without-library
// # The constructor calls a method on this in front of the store, and the method reads the field: undefined.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class P { constructor() { this.seen = this.look(); this.x = 5; this.after = this.look(); } look() { return this.x; } }
function read(p) { return p.x; }
const p = new P();
report(p.seen);
report(p.after);
report(p.look());
report(read(p));
report("end");
