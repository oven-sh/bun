// answers: without-library
// # elements were stored behind the end of a kept arguments object of strict code: its length stays what it was; the bound of the loop comes out of a list that has left, so the loop stays a loop and the read stands in it
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
"use strict";
const upTo = [0, 1, 2, 3, 4, 5];
globalThis.bounds = upTo;
function keep() { return arguments; }
const kept = keep(1, "two", null);
kept[3] = 4;
kept[9] = 10;
function count(list, turn) { let sum = turn; for (let i = 0; i < upTo[4]; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) report(String(count(kept, turn)));
report("end");
