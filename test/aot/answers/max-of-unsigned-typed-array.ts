// answers: without-library
// # The elements of a Uint16Array have no sign: one above 32767 is greater than one below, for every length of the view.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
function greatest(length: number, start: number): number { const view = new Uint16Array(length); for (let k = 0; k < length; k++) view[k] = k * 7919; let found = start | 0; for (let k = 0; k < view.length; k++) found = view[k]! > found ? view[k]! : found; return found; }
for (const length of [0, 1, 7, 16, 33, 70]) { report(greatest(length, 0)); report(greatest(length, 40000)); report(greatest(length, -1)); }
report("end");
