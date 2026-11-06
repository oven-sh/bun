// answers: without-library
// # a read off what the read before handed back: the receiver lies in the register of results. No move stands at the place: the call enters the stub one instruction earlier, where the stub brings the receiver to its register itself.
// # A receiver that lives on is brought in line as before, and so is one beside which the register of results is filled anew.
// # f1 = chain, f2 = twice
// # RUN(CHAIN): bytes f1:Body mechanisms=all-Inlining
// # CHAIN: Call Stub ReadAtSite
// # CHAIN: Call Stub ReadAtSite{{*}}, entered in front
// # CHAIN: Call Stub ReadAtSite{{*}}, entered in front
// # The parameter arrives in the first register of arguments. On x86_64 that is another register than the one of results, so the first read is entered at its head. On arm64 the two are one register.
// # RUN(FIRST): bytes f1:Body mechanisms=all-Inlining
// # REQUIRES(FIRST): x86_64
// # FIRST: Call Stub ReadAtSite
// # FIRST-NOT: entered in front
// # FIRST: Call Stub ReadAtSite{{*}}, entered in front
// # RUN(TWICE): bytes f2:Body mechanisms=all-Inlining
// # REQUIRES(TWICE): x86_64
// # TWICE-NOT: entered in front
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
const boxes = JSON.parse('[{"inner":{"deep":{"value":7}},"left":1,"right":2},{"inner":{"deep":{"other":0,"value":"text"}},"right":4,"left":3},{"inner":{"deep":{}},"left":"a","right":"b"}]');
function chain(box) { return box.inner.deep.value; }
function twice(box) { return box.left + box.right; }
for (const box of boxes) { report(chain(box)); report(twice(box)); }
report("end");
