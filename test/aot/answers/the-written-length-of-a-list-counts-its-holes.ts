// answers: with-library
// # `[1, , 3, 4]` has four places. A step of the for-of over it lies in bounds behind `position < 4`, the length as it is written.
// # Where the build verifies, that number is held against the list as it is made. Only a list made without a hole counted, and a right build stopped: whether a list is made whole is asked for presence alone.
// # OPTIONS: check=Validate
// # f1 = run
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = NewArray {{*}}holes=[1]
// # FORM: = GetArrayElement {{*}}isInBounds
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let total: any = 0.5;
function run(mark: any): string { let t = ""; let c: any = [1, , 3, 4]; let last: any = null; for (let r = 0; r < 3; r++) { { const i = r; if (last !== null) last(); if (i & 1) last = function () { total += 0.5; }; t += total; } let i = -1; for (let x of c as any) { i++; total += typeof x === "number" ? x : 1; if (i === 1) { mark = c.length; } } } return String(total) + " " + t + " " + String(mark); }
report(run(7));
report("end");
