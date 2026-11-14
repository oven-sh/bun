// answers: without-library
// # Object.create() of the prototype object makes an object that finds the methods of the class and has none of its fields.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class P { constructor() { this.x = 1; } get() { return this.x; } has() { return "x" in this; } }
const bare = Object.create(P.prototype);
report(bare.get());
report(bare.has());
const made = new P();
report(made.get());
report(made.has());
report("end");
