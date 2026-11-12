// answers: without-library
// # The read of the method throws in front of the arguments where the receiver is null or undefined.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } get twice() { return this.count * 2 } }
let order = "";
function note(text, value) { order += text; return value }
function stepOf(counter) { return counter.step(note("argument ", 1)) }
function twiceOf(counter) { return counter.twice }
function pick(which) { return which === 0 ? null : which === 1 ? undefined : new Counter(which) }
for (let which = 0; which < 3; which++) { try { report(stepOf(pick(which))) } catch (error) { report(error instanceof TypeError) } }
report(order);
for (let which = 0; which < 3; which++) { try { report(twiceOf(pick(which))) } catch (error) { report(error instanceof TypeError) } }
report(pick(0)?.step(1));
report(pick(2)?.step(1));
report("end");
