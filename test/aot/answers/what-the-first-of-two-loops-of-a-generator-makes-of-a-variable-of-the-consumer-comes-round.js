// answers: with-library
// # A generator has two loops; the turns at the yields of the first store a number into a variable of the consumer born undefined. What enters the second loop is the number.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
const n = (value) => JSON.parse("" + value);
function* parts(count) { for (let i = 0; i < count; i++) yield "t" + i; for (let i = 0; i < count; i++) yield i; }
function run(count) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let found; for (const part of parts(count)) { if (typeof part === "string") found = part.length; } return typeof found + " " + found + " " + work; }
report(run(n(3)));
report(run(n(2)));
report("end");
