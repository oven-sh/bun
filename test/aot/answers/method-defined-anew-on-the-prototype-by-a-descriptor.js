// answers: without-library
// # Object.defineProperty() replaces a method by another value, then by a getter, then hides it on one instance.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } }
function stepOf(counter, by) { return counter.step(by) }
const counter = new Counter(10);
report(stepOf(counter, 1));
Object.defineProperty(Counter.prototype, "step", { value(by) { return this.count - by }, configurable: true });
report(stepOf(counter, 1));
Object.defineProperty(Counter.prototype, "step", { get() { return () => "from a getter" }, configurable: true });
report(stepOf(counter, 1));
Object.defineProperty(counter, "step", { value() { return "own" } });
report(stepOf(counter, 1));
report(stepOf(new Counter(1), 1));
report("end");
