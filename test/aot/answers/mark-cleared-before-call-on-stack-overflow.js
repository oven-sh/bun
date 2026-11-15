// answers: without-library
// # A function sets a mark, takes it away and then calls a built-in. Where the stack ends the call throws a RangeError, and whoever catches it finds no mark, at every depth near the end.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
const flags = [0]; flags[0] = flags.length; const isOn = flags[0] > 0;
const list = [3, 1, 2];
const holder = { mark: 0 };
let kept, reached = 0, found = 0, limit = 0, goal = 1e9;
function writes() { holder.mark = 1; if (!isOn) return 1; holder.mark = 0; kept = JSON.stringify(list); return 0; }
function descend(depth) { reached++; return depth > 0 ? descend(depth - 1) + 1 : writes(); }
for (let turn = 0; turn <= 60; turn++) { reached = 0; try { descend(goal); } catch (error) { if (holder.mark) found++; holder.mark = 0; } if (turn === 0) limit = reached; goal = limit + 20 - turn; }
report(found);
report("end");
