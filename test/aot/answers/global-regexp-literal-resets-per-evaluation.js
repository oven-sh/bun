// answers: without-library
// # A pattern literal with the flag g makes a new object each time it is evaluated: every search starts at the first character.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
function found(text) { const pattern = /a+/g; return pattern.test(text); }
for (const text of ["ab", "ab", "ba", "ab"]) report(found(text));
report("end");
