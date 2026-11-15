// answers: without-library
// # A call of another function in tail position gives up the frame, a million deep: two and three functions that are small enough to be copied into one another, a callee that takes more than its caller has room for, callees by value.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
function even(n) { if (n === 0) return true; return odd(n - 1); }
function odd(n) { if (n === 0) return false; return even(n - 1); }
function first(n) { if (n === 0) return 1; return second(n - 1); }
function second(n) { if (n === 0) return 2; return third(n - 1); }
function third(n) { if (n === 0) return 3; return first(n - 1); }
function handsOn(n) { return counts(n); }
function counts(n) { if (n === 0) return "bottom"; return handsOn(n - 1); }
function few(n) { if (n === 0) return 0; return many(n - 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); }
function many(n, a, b, c, d, e, f, g, h, i, j, k, l) { if (n === 0) return a + l; return few(n - 1); }
function round(self, other, n) { if (n === 0) return "by value"; return other(other, self, n - 1); }
function roundToo(self, other, n) { if (n === 0) return "by value too"; return other(other, self, n - 1); }
function behindTry(n) { try { if (n < 0) throw n; } catch (e) { return e; } return behindTryToo(n - 1); }
function behindTryToo(n) { if (n === 0) return "behind a try"; return behindTry(n - 1); }
function fraction(n) { if (n === 0) return 0.5; return fractionToo(n - 1); }
function fractionToo(n) { if (n === 0) return 1.5; return fraction(n - 1); }
report(even(1000000));
report(first(1000000));
report(counts(1000000));
report(few(1000000));
report(few(1000001));
report(round(round, roundToo, 1000000));
report(behindTry(1000001));
report(fraction(1000000));
report("end");
