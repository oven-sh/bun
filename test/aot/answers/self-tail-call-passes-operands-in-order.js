// answers: without-library
// # A call of the function itself in tail position becomes a jump, and each parameter takes the operand that stands at its place.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
function walk(turns, a, b) { return turns <= 0 ? a * 1000 + b : walk(turns - 1, b, a + b); }
report(walk(0, 1, 2)); report(walk(1, 1, 2)); report(walk(5, 1, 2));
report("end");
