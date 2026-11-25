// answers: without-library
// # a sloppy wrapper stores to a parameter, which its arguments object shows, in front of handing the object on
// # the twin of programs/tail-calls/wrapper-whose-arguments-alias-its-parameters.cjs, made by integration/tests/program-to-answers.py: the test of a `sound` control is an .ir; the program stands beside it
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
function target() { return arguments.length + "/" + Array.prototype.join.call(arguments); }
function wrap(a, b) { a = 7; return target.apply(this, arguments); }
function deed(count) { if (count === 0) return wrap(); if (count === 1) return wrap(1); if (count === 2) return wrap(1, 2); return wrap(1, 2, 3); }
report(String(deed(2)));
for (let i = 0; i < 4; i++) report(String(deed(i)));
report(String(deed(1)));
report("end");
