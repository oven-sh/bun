// answers: without-library
// # Reflect.construct() with a plain function as new.target: the constructor of the class makes an object that stands below another prototype object.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
class Counter { constructor(start) { this.count = start } step(by) { return this.count + by } get twice() { return this.count * 2 } }
function Stranger() { }
Stranger.prototype.step = function (by) { return this.count * by };
function stepOf(counter, by) { return counter.step(by) }
const plain = new Counter(10);
const strange = Reflect.construct(Counter, [20], Stranger);
report(stepOf(plain, 3));
report(stepOf(strange, 3));
report(plain.twice);
report(strange.twice);
report(strange instanceof Counter);
report(strange instanceof Stranger);
report("end");
