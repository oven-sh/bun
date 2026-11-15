// answers: without-library
// # The looks at the outer loop follow both sides of the branch, see a number or a text enter the inner loop, and settle at once. The walk decides the branch and sees a number enter, and its own looks at the inner loop widen what grows.
// # The inner loop takes what the outer looks settled on, so what leaves it lies within what the outer head was promised.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
function off() { return false; }
function run(n) { let r = 0; for (let i = 0; i < n; i++) { let a = off() ? "s" : 0, b = a, c = a; for (let j = 0; j < 3; j++) { c = b; b = a; a = "s"; } r = c; } return r; }
report(run(2));
report(run(0));
report("end");
