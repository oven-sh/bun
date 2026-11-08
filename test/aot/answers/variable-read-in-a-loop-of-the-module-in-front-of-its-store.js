// answers: without-library
// # The readers and a writer are called in a loop and in line in front of the declarations, and again behind them.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
function attempt(f) { try { return f(); } catch (error) { return error.name; } }
function read() { return late; }
function write() { stored = 2; return stored; }
for (let turn = 0; turn < 2; turn++) { report(attempt(read)); }
report(attempt(write));
const late = 3;
let stored = 1;
for (let turn = 0; turn < 2; turn++) { report(attempt(read)); }
report(attempt(write));
report(stored);
report("end");
