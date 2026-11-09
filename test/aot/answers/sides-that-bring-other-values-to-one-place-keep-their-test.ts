// answers: without-library
// # both sides of a branch run nothing and come to one block, but each brings it another value: the test decides which of the two, and stays. Where both bring the same value it goes
// # both values of either are parameters, so no operation stands on either side: a constant that is written on a side stands in a block of that side, and the way ends there
// # f1 = either, f2 = same, f3 = each
// # RUN(KEPT): walk f1 mechanisms=none+Folding
// # KEPT-LABEL: code f1:Body
// # KEPT: Branch
// # RUN(FORM): walk f2 mechanisms=none+Folding
// # FORM-NOT: Branch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const flags: unknown[] = [0, 1, "", "x", null, undefined, NaN, true, false];
function either(c: unknown, a: unknown, b: unknown) { const x = c ? a : b; return x; }
function same(c: unknown, a: unknown) { const x = c ? a : a; return x; }
function each(f: (c: unknown) => unknown) { for (let i = 0; i < flags.length; i++) report(f(flags[i])); }
each(c => either(c, "taken", "other"));
each(c => either(c, c, "other"));
each(c => same(c, "same"));
report("end");
