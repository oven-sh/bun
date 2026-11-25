// answers: with-library
// # A generator yields a text in front of its loop; the consumer's turn at that yield stores the text into a variable born a number. What enters the generator's own loop is the text.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
const n = (value) => JSON.parse("" + value);
function* parts(count) { yield "head"; for (let i = 0; i < count; i++) yield i; }
function run(count) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let found = 0; for (const part of parts(count)) { if (typeof part === "string") found = part; } return typeof found + " " + found + " " + found.length + " " + work; }
report(run(n(3)));
report(run(n(2)));
report("end");
