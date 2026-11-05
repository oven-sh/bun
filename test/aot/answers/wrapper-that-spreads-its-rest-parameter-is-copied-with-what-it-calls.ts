// answers: without-library
// # `function outer(...xs) { return inner(...xs); }`: in the copy of outer the state knows what the list holds, so the call of the list is the call that writes the elements out, and inner is copied in its place.
// # f1 = inner, f2 = outer, f3 = run
// # RUN(FORM): walk f3 mechanisms=all
// # FORM: frame 1 callee=f2
// # FORM: frame 2 callee=f1
// # RUN(NEVER): walk f3 mechanisms=all
// # NEVER-NOT: NewArray
// # NEVER-NOT: CallList
// # NEVER-NOT: CallDirect
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
function inner(a: number, b: number): number { return a * 10 + b; }
function outer(...xs: [number, number]): number { return inner(...xs); }
function run(turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) { sum += outer(i, 1); } return sum; }
report(run(1000));
report(outer(2, 3));
report("end");
