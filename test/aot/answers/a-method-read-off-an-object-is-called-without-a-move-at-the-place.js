// answers: without-library
// # `held.run?.(1)`: the read of the method hands the callee back in the register of results, and the receiver waits in the register in which the read took it. The convention of calls wants the callee and `this` elsewhere.
// # The stub that calls by value brings both where they belong, in front of its entry, and the place holds neither move. A function that is called without `this` has a head of one move.
// # f1 = give, f2 = runs, f3 = calls
// # The head of two moves is pinned in the engine's own tests (machine/the-callee-and-this-of-a-call-by-value-are-brought-by-the-stub.ir): under the words that check proofs other code stands between the read and the call.
// # RUN(CALLS): bytes f3:Body mechanisms=all-Inlining
// # REQUIRES(CALLS): x86_64
// # CALLS: Call Stub CallValueWithoutThis.{{*}}, entered in front
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL mechanisms=all
// # CHECK: exited with 0
const boxes = JSON.parse('[{"held":{"mark":1}},{"held":{"mark":2}},{"held":{"mark":3}}]');
boxes[0].held.run = function (more) { return (this === undefined || this === globalThis ? 100 : this.mark) + more; };
boxes[1].held.run = function (more) { "use strict"; return (this === undefined ? 200 : this.mark * 10) + more; };
boxes[2].held.run = 7;
function give(box) { return box.held.run; }
function runs(held) { return held.run?.(1) + 1; }
function calls(box) { return give(box)(2) + 1; }
for (const box of boxes) {
  try { report(runs(box.held)); } catch (error) { report(error instanceof TypeError); }
  try { report(calls(box)); } catch (error) { report(error instanceof TypeError); }
}
report("end");
