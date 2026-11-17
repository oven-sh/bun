// answers: without-library
// # A method that a statement lays on a prototype object is read as the function or undefined, and its call gets a test in front. If what the test proves stayed bound to the read behind the call, a use behind the join would name a value of one arm: the build stopped where an await asked for all that is alive.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function P(a) { this.a = a; }
P.prototype.five = function () { return 5; };
P.prototype.six = function () { return 6; };
const kept = [];
function onTwoPaths(first) { const made = new P(1); const m = made.five; let total = 0; if (first) total += m(); kept.push(m); return total + m(); }
function inLoop(n) { const made = new P(1); const m = made.six; let total = 0; for (let i = 0; i < n; i++) { if (i & 1) total += m(); } kept.push(m); return total; }
async function behindAnAwait(first, later) { const made = new P(2); let total = await later; const m = made.five; if (first) total += m(); kept.push(m); return total; }
async function overAnAwait(first, later) { const made = new P(2); const m = made.six; let total = 0; if (first) total += m(); total += await later; kept.push(m); return total + m(); }
report(onTwoPaths(true));
report(onTwoPaths(false));
report(inLoop(7));
report(inLoop(0));
behindAnAwait(true, Promise.resolve(100)).then(value => { report(value); return behindAnAwait(false, 200); }).then(value => { report(value); return overAnAwait(true, 300); }).then(value => { report(value); return overAnAwait(false, 400); }).then(value => { report(value); report(kept.length); report(kept.every(m => m === P.prototype.five || m === P.prototype.six)); report("end"); });
