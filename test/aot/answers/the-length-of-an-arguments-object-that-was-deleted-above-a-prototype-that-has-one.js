// answers: without-library
// # the length of a kept arguments object was deleted and its prototype exchanged for an object that has one: the read finds that one
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
"use strict";
function keep() { return arguments; }
const kept = keep(1, "two", null);
delete kept.length;
Object.setPrototypeOf(kept, { length: 9 });
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) report(String(count(kept, turn)));
report("end");
