// answers: without-library
// # A call of a method on a proven receiver is a direct call only where no store reaches the member: here the program stores another function on the prototype object between two calls through one site.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } }
function stepOf(counter, by) { return counter.step(by) }
const counter = new Counter(10);
report(stepOf(counter, 1));
report(counter.step(2));
Counter.prototype.step = function (by) { return this.count - by };
report(stepOf(counter, 1));
report(counter.step(2));
report(stepOf(new Counter(20), 5));
report("end");
