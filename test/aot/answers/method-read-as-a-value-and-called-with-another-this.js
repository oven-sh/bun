// answers: without-library
// # The read of a method gives the function object: it is called with other receivers, bound, compared, and called without a receiver.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } self() { return this } }
const counter = new Counter(10);
const step = counter.step;
const other = { count: 100, step: counter.step, self: counter.self };
report(other.step(1));
report(counter.step(1));
report(other.self() === other);
const self = counter.self;
report(self() === undefined);
report(counter.self() === counter);
report(counter.step === Counter.prototype.step);
report(other.step === step);
let thrown = "nothing";
try { step(1) } catch (error) { thrown = error instanceof TypeError }
report(thrown);
report("end");
