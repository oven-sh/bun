// answers: without-library
// # A store on one instance under the name of a method hides the method for that instance alone, so the call through the shared site may enter either function.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } }
function stepOf(counter, by) { return counter.step(by) }
const first = new Counter(10);
const second = new Counter(20);
report(stepOf(first, 1));
report(stepOf(second, 1));
second.step = function (by) { return this.count * by };
report(stepOf(first, 3));
report(stepOf(second, 3));
report(first.step(4));
report(second.step(4));
report("end");
