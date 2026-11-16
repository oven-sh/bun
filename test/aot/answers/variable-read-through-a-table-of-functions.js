// answers: without-library
// # The reader is found under a key that is put together when the program runs.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
function attempt(f) { try { return f(); } catch (error) { return error.name; } }
const table = { a() { return late; }, b() { return late + 1; } };
let pick = "a";
report(attempt(table[pick]));
pick = "b";
report(attempt(table[pick]));
const late = 1;
report(attempt(table[pick]));
pick = "a";
report(attempt(table[pick]));
report("end");
