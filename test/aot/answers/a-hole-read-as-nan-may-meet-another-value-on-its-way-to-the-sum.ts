// answers: with-library
// # `same += pair[i % pair.length]`: the read takes NaN for a hole, since the sum is its one user. The read of the typed way and that of the other way meet in a parameter in front of the sum.
// # Where the build verifies, the value is followed into the parameter and the parameter's users are held to the rule. The edge itself was taken for a user that tells NaN from undefined, and a right build stopped.
// # OPTIONS: check=Validate
// # f1 = run
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetArrayElement {{*}}readsHoleAsNaN
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function run(c: any[], end: number): number { const to = end | 0; const pair = [1, 2]; let same = -1; for (let r = 0; r < 3; r++) { if (r > to + 9) pair.push(r); let i = -1; for (let x of c as any) { i++; same += i === 1 || i === to ? 1 : 0; same += pair[i % pair.length]; } } return same; }
report(run([1, 2, 3, 4], 3));
report(run([1, 2, 3, 4], 4));
report("end");
