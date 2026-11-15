// answers: with-library
// # a RegExp in a variable gets an exec of its own: replace asks it
// # RUN(FORM): link variables
// # FORM: variable g0 
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
const marks = /b/g;
let calls = 0;
marks.exec = function () { calls++; return null; };
function strip(text) { return text.replace(marks, "x"); }
report(strip("abcb"));
report(calls);
report("end");
