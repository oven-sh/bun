// answers: without-library
// # The initializer of the second field of a class deletes the first, and the constructor adds to it: the sum is no number, and the name comes back behind the others.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
const extraTurns = Date.now() < 0 ? 1 : 0;
function interrupt(self) { delete self.a; return "b"; }
class Thing { a = 1; b = interrupt(this); c = 3; constructor(seed) { this.a += seed; } }
function total(one) { return one.a + one.c + String(one.b).length; }
function run(seed) { const things = []; for (let at = 0; at < 3 + extraTurns; at++) things.push(new Thing(seed + at)); let said = ""; for (let turn = 0; turn < 4 + extraTurns; turn++) { const one = things[turn % 3]; said += total(one) + ":" + Object.keys(one).join("+") + ","; } return said; }
report(run(1)); report(run(2));
report("end");
