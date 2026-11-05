// answers: without-library
// # The list is made by an operation of this very body, only push() and the return name it, and it stands in front of the loop: whatever change() runs cannot reach it. Behind the return it goes to unseen code, so Link says nothing of it.
// # One look at the body says so for all its receivers. The word is held against the list where it is taken, as a word of Link is: one bit of the cell, a stop by name. Behind it the push stands in line.
// # RUN(HELD): walk f1 mechanisms=all
// # HELD-LABEL: code f1:Body
// # HELD: isLoopHead=true
// # HELD: = IsPristine {{*}}builtinClass=Array
// # HELD: CheckProof {{*}}checkedType=true
// # HELD: inlineBuiltin=ArrayPush
// # RUN(UNREAD): walk f1 mechanisms=all
// # UNREAD-NOT: key="push"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
function gather(count: number, change: (k: number) => number): number[] { const result: number[] = []; for (let k = 0; k < count; k++) result.push(change(k)); return result; }
const changes = [(k: number) => k * 2, (k: number) => k + 1];
for (let round = 0; round < 4; round++) report(gather(round + 1, changes[round % 2]));
report("end");
