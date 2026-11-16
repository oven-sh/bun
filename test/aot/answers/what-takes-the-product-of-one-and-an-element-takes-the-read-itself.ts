// answers: with-library
// # `const v = 1 * list[i]; if (v > m) m = v;`: the product is the one user of the read, so the read takes NaN for a hole. The walk folds `1 *`: the read's record stands for the product, and the comparison takes it.
// # What reaches the comparison is the NaN that the program itself makes of a hole. Where the build verifies, only a read that some arithmetic of the finished code takes is held to have no other user; a right build stopped here.
// # OPTIONS: check=Validate
// # f1 = most
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: [[read]]: {{*}} = GetArrayElement {{*}}readsHoleAsNaN
// # FORM: = Greater [[read]],
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function most(list: number[]): number { let m = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[i]!; if (v > m) m = v; } return m; }
const whole: number[] = [];
const holed: number[] = [];
for (let k = 0; k < 40; k++) { whole.push(k + 0.5); holed.push(k + 0.5); }
delete holed[39];
report(most(whole));
report(most(holed));
holed[39] = 77.5;
report(most(holed));
report("end");
