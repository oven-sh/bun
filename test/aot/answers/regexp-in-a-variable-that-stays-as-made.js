// answers: with-library
// # a RegExp in a variable stays as made: lastIndex is read and stored as ever, and what replace gives is iterated over as a text
// # RUN(FORM): link variables
// # REQUIRES(FORM): entries-of-bun
// # FORM: variable g0 
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
const marks = /b/g;
const sticky = /b/y;
function strip(text) { return text.replace(marks, "x"); }
function first(text) { return text.replace(sticky, "x"); }
function width(text) { let n = 0; for (const ch of strip(text)) n += ch.codePointAt(0) > 255 ? 2 : 1; return n; }
report(strip("abcb"));
marks.lastIndex = 3;
report(strip("abcb"));
report(marks.lastIndex);
sticky.lastIndex = 1;
report(first("abcb"));
report(sticky.lastIndex);
report(first("abcb"));
report(sticky.lastIndex);
report(width("ab中😀b"));
report(strip(""));
report("end");
