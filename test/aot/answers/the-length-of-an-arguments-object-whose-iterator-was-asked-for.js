// answers: without-library
// # a kept arguments object of strict code was asked for its iterator, which lays it on the object, and is asked for its length afterwards
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
"use strict";
function keep() { return arguments; }
const kept = keep(1, "two", null);
report(typeof kept[Symbol.iterator]);
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) report(String(count(kept, turn)));
report("end");
