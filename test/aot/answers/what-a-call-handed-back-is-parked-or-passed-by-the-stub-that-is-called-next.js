// answers: without-library
// # What a call has handed back lies in the register of results. The stub that is called next brings it where it is wanted, in front of its entry, and the place holds no move:
// # into the register of its operand (the key of a lookup in a table; the object behind `in`, which the stub leaves there, so that it is used again).
// # f1 = give, f2 = holds, f3 = names
// # RUN(NAMES): bytes f3:Body mechanisms=all-Inlining
// # REQUIRES(NAMES): x86_64
// # NAMES: Call Stub FindsNameAtSite{{*}}, entered in front
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL mechanisms=all
// # CHECK: exited with 0
const boxes = JSON.parse('[{"held":{"flag":1}},{"held":{"other":0}},{"held":{}}]');
const table = new Map();
function give(box) { return box.held; }
function holds(box) { return table.has(give(box)); }
function names(box) { const held = give(box); if ("flag" in held) return held.flag; return held.other; }
table.set(boxes[1].held, 1);
for (const box of boxes) { report(holds(box)); report(names(box)); }
report("end");
