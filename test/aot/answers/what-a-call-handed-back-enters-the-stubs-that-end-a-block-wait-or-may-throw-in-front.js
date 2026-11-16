// answers: without-library
// # What a call has handed back lies in the register of results. A stub that takes it as its operand brings it to its register itself: the place calls one instruction in front of the stub's entry and holds no move.
// # Four kinds of places had the move all the same, though their stubs have the head: a call that ends its block with a branch on the stub's flags (a comparison with a short text, a read that is only asked for its truth),
// # a wait, whose call is written by a generator of its own, and a call that names a place to throw at.
// # f1 = give, f2 = short, f3 = truth, f4 = called, f5 = tries, f6 = waits
// # RUN(SHORT): bytes f2:Body mechanisms=all-Inlining
// # REQUIRES(SHORT): x86_64
// # SHORT: Call Stub ValueEqualsLiteralOfLength{{*}}, entered in front
// # RUN(CALLED): bytes f4:Body mechanisms=all-Inlining
// # REQUIRES(CALLED): x86_64
// # CALLED: Call Stub ThrowUnlessCallable{{*}}, entered in front
// # RUN(WAITS): bytes f6:CoroutineBody mechanisms=all-Inlining
// # REQUIRES(WAITS): x86_64
// # WAITS: Call Stub AwaitBySavingFrame{{*}}, entered in front
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL mechanisms=all
// # CHECK: exited with 0
const boxes = JSON.parse('[{"held":"abc"},{"held":{"flag":1}},{"held":{"flag":0}},{"held":"abd"},{"held":7}]');
function give(box) { return box.held; }
function short(box) { if (give(box) === "abc") return "same"; return "other"; }
function truth(box) { if (give(box).flag) return "true"; return "false"; }
function called(box) { const held = give(box); return held(1); }
function tries(box) { try { return called(box); } catch (error) { return "threw"; } }
async function waits(box) { const held = await give(box); return typeof held; }
boxes.push({ held: function (one) { return one + 1; } });
for (const box of boxes) { report(short(box)); report(truth(box)); report(tries(box)); }
for (const box of boxes) report(await waits(box));
report("end");
