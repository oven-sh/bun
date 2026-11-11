// answers: with-library
// # a RegExp in a variable gets a name under a key that is computed, in a function that is handed the object
// # RUN(FORM): link variables
// # FORM: variable g0 
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
const marks = /b/g;
let calls = 0;
function lay(object, key, value) { object[key] = value; }
function keyOf(parts) { return parts[0] + parts[1]; }
lay(marks, keyOf(["ex", "ec"]), function () { calls++; return null; });
function strip(text) { return text.replace(marks, "x"); }
report(strip("abcb"));
report(calls);
report("end");
