// answers: without-library
// # The key of the store is put together when the program runs, and it spells the name of a method.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } }
function stepOf(counter, by) { return counter.step(by) }
function lay(object, key, value) { object[key] = value }
const first = new Counter(10);
const second = new Counter(20);
report(stepOf(first, 1));
lay(second, "st" + "ep", function (by) { return this.count * by });
report(stepOf(first, 3));
report(stepOf(second, 3));
report("end");
