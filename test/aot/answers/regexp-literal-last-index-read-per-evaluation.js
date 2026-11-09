// answers: without-library
// # A search converts lastIndex to a number also without the flags g and y: an object stored there is asked each time.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
let said = "";
function found(text) { const pattern = /a+/; pattern.lastIndex = { valueOf() { said += "asked,"; return 1; } }; return pattern.test(text); }
for (const text of ["ab", "ba", "b"]) report(found(text));
report(said);
report("end");
