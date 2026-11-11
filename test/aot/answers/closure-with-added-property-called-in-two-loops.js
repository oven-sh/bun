// answers: without-library
// # A captured variable holds a closure or a number. On some turns the closure is given a member, and then it is called in two loops that follow each other: it is still the function it was.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
const one = Date.now() > 0 ? 1 : 2;
function make() { const o = { k: one, m: a => o.k + a }; return o.m; }
function use(turn, count) { let v = make(); const read = () => { let r = 0; for (let i = 0; i < count; i++) r += v(i); for (let i = 0; i < count; i++) r -= v(i * 2); return r; }; if (turn % 2) v.tag = turn; if (turn % 20 === 7) v = 2.5; return read; }
for (let turn = 0; turn < 9; turn++) { try { report(use(turn, 3 + (one - 1))()); } catch (error) { report(error.name); } }
report("end");
