// answers: with-library
// # a RegExp in a variable gets another object above it: replace finds the method there
// # RUN(FORM): link variables
// # FORM: variable g0 
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
const marks = /b/g;
Object.setPrototypeOf(marks, { [Symbol.replace](text, by) { return "above:" + text + ":" + by; } });
function strip(text) { return text.replace(marks, "x"); }
report(strip("abcb"));
report("end");
