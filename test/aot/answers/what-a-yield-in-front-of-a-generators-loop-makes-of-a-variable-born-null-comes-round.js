// answers: with-library
// # A generator yields a text in front of its loop; the consumer's turn at that yield stores a number into a variable born null. The compiled program once answered `object null`.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
const n = (value) => JSON.parse("" + value);
function* parts(count) { yield "head"; for (let i = 0; i < count; i++) yield i; }
function run(count) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let found = null; for (const part of parts(count)) { if (typeof part === "string") found = part.length; } return typeof found + " " + found + " " + work; }
report(run(n(3)));
report(run(n(2)));
report("end");
