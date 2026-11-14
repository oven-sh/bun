// answers: without-library
// # Object.setPrototypeOf() on one instance: the layout stays, and the lookup goes another way.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } }
function stepOf(counter, by) { return counter.step(by) }
const first = new Counter(10);
const second = new Counter(20);
report(stepOf(first, 1));
report(stepOf(second, 1));
Object.setPrototypeOf(second, { step(by) { return this.count * by } });
report(stepOf(first, 3));
report(stepOf(second, 3));
report(second.step(4));
report("end");
