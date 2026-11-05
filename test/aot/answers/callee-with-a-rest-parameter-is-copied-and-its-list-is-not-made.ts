// answers: without-library
// # `function add(...xs)`: the copy makes the list that the entry of the callee would make, the state knows what it holds, and nobody needs it: no list, no call.
// # f1 = add, f2 = run
// # RUN(FORM): walk f2 mechanisms=all
// # FORM: frame 1 callee=f1
// # FORM: Add {{*}}form=Integers
// # RUN(NEVER): walk f2 mechanisms=all
// # NEVER-NOT: NewArray
// # NEVER-NOT: CallDirect {{*}}function=f1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
function add(...xs: number[]): number { return xs[0] + xs[1]; }
function run(turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) { sum += add(i, 1); } return sum; }
report(run(1000));
report(add(2, 3));
report("end");
