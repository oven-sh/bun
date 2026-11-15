// answers: with-library
// # a RegExp in a variable gets a method under Symbol.replace of its own: replace calls it
// # RUN(FORM): link variables
// # FORM: variable g0 
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
const marks = /b/g;
marks[Symbol.replace] = function (text, by) { return "own:" + text + ":" + by; };
function strip(text) { return text.replace(marks, "x"); }
report(strip("abcb"));
report("end");
