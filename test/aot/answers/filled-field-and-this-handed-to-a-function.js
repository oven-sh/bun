// answers: without-library
// # The constructor hands this to a function in front of the store, and the function reads and tests the field.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
function look(p) { return p.x; }
function has(p) { return "x" in p; }
class P { constructor() { this.seen = look(this); this.had = has(this); this.x = 5; } }
const p = new P();
report(p.seen);
report(p.had);
report(look(p));
report(has(p));
report("end");
