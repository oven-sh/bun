// answers: without-library
// # Link follows the order in which a program starts and leaves the test of the dead zone out where every reader runs behind the store: here one call of each reader stands in front of it.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
function attempt(f) { try { return f(); } catch (error) { return error.name; } }
function read() { return late; }
function inner() { return other + 1; }
function outer() { return inner(); }
report(attempt(read));
const early = attempt(outer);
const late = "a";
let other = 1;
report(attempt(read));
report(early);
report(attempt(outer));
report("end");
