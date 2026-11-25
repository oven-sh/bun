// answers: without-library
// # A counter that is expected to stay a whole number of 32 bits is kept as one, behind tests. Here it gets a fraction on a turn that is seldom taken, steps by a fraction, passes either end of the range, or becomes -0.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
function count(list) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] < 0) n += 0.5; else n += 1; } return n; }
report(count([1, 2, 3])); report(count([1, -2, 3])); report(count([-1, -2, 3, 4]));
function steps(limit, step) { let n = 0; for (let i = 0; i < limit; i += step) n++; return n; }
report(steps(10, 1)); report(steps(10, 2.5)); report(steps(3, 0.5));
function grows(times) { let n = 2147483640; for (let i = 0; i < times; i++) n += 3; return n; }
report(grows(1)); report(grows(4));
function falls(times) { let n = -2147483640; for (let i = 0; i < times; i++) n -= 3; return n; }
report(falls(1)); report(falls(4));
function zero(list) { let n = 0; for (let i = 0; i < list.length; i++) n = n * list[i]; return n; }
report(zero([1, 2])); report(zero([-1, 2]));
report("end");
