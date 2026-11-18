// answers: without-library
// # Object.assign() lays a property of the instance's own in front of the method.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } }
function stepOf(counter, by) { return counter.step(by) }
const first = new Counter(10);
const second = new Counter(20);
report(stepOf(second, 1));
Object.assign(second, { step(by) { return this.count * by } });
report(stepOf(first, 3));
report(stepOf(second, 3));
report("end");
