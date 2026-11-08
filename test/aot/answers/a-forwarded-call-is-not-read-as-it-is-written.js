// answers: without-library
// # `Math.floor.call(whole / 2)` rounds nothing: the quotient is only what `this` is. `Math.trunc.call(7, x) | 0` truncates x, not 7. Two rules on numbers read the operands off the call as the body writes it.
// # At the end the shell runs the same text itself: every answer is the same.
// # Without the library `.call` answers undefined unless the walk forwards it.
// # OPTIONS: mechanisms=all
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
const unseen = (0, eval)("(x) => x");
function halfOf(count) { const whole = count | 0; return Math.floor.call(whole / 2); }
function halfApplied(count) { const whole = count | 0; return Math.floor.apply(whole / 2); }
function halfOfOther(count, other) { const whole = count | 0; return Math.floor.call(whole / 2, other); }
function wholePart(amount) { const number = +amount; return Math.trunc.call(7, number) | 0; }
function wholePartApplied(amount) { const number = +amount; return Math.trunc.apply(7, [number]) >>> 0; }
function lowBits(amount) { const number = +amount; return Math.trunc.call(7, number) & 255; }
function notOf(amount) { const number = +amount; return ~Math.trunc.call(7, number); }
function asWritten(count, amount) { const whole = count | 0; const number = +amount; return Math.floor(whole / 2) + (Math.trunc(number) | 0); }
function ask() { report(halfOf(unseen(7))); report(halfApplied(unseen(7))); report(halfOfOther(unseen(7), unseen(10.6))); report(wholePart(unseen(12.75))); report(wholePartApplied(unseen(12.75))); report(lowBits(unseen(12.75))); report(notOf(unseen(12.75))); report(asWritten(unseen(7), unseen(12.75))); }
ask();
ask();
report("end");
