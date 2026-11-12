// answers: without-library
// # A super call stands in a loop, under a parent that a variable holds. The typed build of the loop proves what is expected of the operands of its operations; a construction of the parent has no callee operand, and the compiler once died asking for it.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
const unseen = (x) => JSON.parse("[" + x + "]")[0];
class First { constructor(a) { this.a = a; } }
class Second { constructor(a) { this.a = a * 2; } }
const Base = unseen(1) ? First : Second;
class Below extends Base { constructor(n) { const last = n | 0; for (let i = 0; i <= last; i++) { if (i === last) super(i); } } }
report(new Below(unseen(3)).a);
report("end");
