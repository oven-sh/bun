// answers: without-library
// # a read off what the read before handed back: the receiver lies in the register of results. No move stands at the place: the call enters the stub one instruction earlier, where the stub brings the receiver to its register itself.
// # A receiver that lives on is brought in line as before, and so is one beside which the register of results is filled anew.
// # f1 = chain, f2 = twice
// # The places that enter in front are pinned in the engine's own tests (machine/a-read-off-what-the-read-before-handed-back-enters-its-stub-in-front.ir): under the words that check the walk other code stands between the reads.
// # RUN(TWICE): bytes f2:Body mechanisms=all-Inlining
// # REQUIRES(TWICE): x86_64
// # TWICE-NOT: entered in front
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL mechanisms=all
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
const boxes = JSON.parse('[{"inner":{"deep":{"value":7}},"left":1,"right":2},{"inner":{"deep":{"other":0,"value":"text"}},"right":4,"left":3},{"inner":{"deep":{}},"left":"a","right":"b"}]');
function chain(box) { return box.inner.deep.value; }
function twice(box) { return box.left + box.right; }
for (const box of boxes) { report(chain(box)); report(twice(box)); }
report("end");
