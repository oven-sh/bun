// answers: without-library
// # the length of a kept arguments object of strict code was overwritten by a text: the read gives the text
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
"use strict";
function keep() { return arguments; }
const kept = keep(1, "two", null);
kept.length = "x";
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) report(String(count(kept, turn)));
report("end");
