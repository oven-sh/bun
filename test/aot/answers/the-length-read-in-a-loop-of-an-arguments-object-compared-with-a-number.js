// answers: without-library
// # the length of a kept arguments object is compared with a written number: as made, overwritten by the same number as a fraction would give it, by a text of the same digits, and deleted; the bound of the loop comes out of a list that has left, so the loop stays a loop and the read stands in it
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
"use strict";
const upTo = [0, 1, 2, 3, 4, 5];
globalThis.bounds = upTo;
function keep() { return arguments; }
const kept = keep(1, "two", null);
const halves = [6, 7];
function count(list, turn) { let sum = "" + turn; for (let i = 0; i < upTo[5]; i++) { sum += ":" + (list.length === 3) + (list.length == 3); if (i === 0) list.length = halves[0] / 2; if (i === 1) list.length = halves[1] / 2; if (i === 2) list.length = "3"; if (i === 3) delete list.length; } list.length = 3; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) report(String(count(kept, turn)));
report("end");
