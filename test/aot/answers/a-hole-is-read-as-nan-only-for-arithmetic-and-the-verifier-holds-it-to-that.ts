// answers: with-library
// # In a loop over a list of numbers that was tested in front, `sum += list[i]` reads a hole as NaN: undefined and NaN give the same sum, so the read asks for no hole. That is a word about whoever takes the value.
// # Where the build verifies, it is held against the program (the one operation that takes the value is arithmetic, or a store into a view) and against the finished code (every record that takes it is such an operation beside a number).
// # A value that is also compared with undefined is read as it lies.
// # OPTIONS: check=Validate
// # f1 = sum, f2 = holes
// # RUN(SUM): walk f1 mechanisms=all
// # SUM-LABEL: code f1:Body
// # SUM: = GetArrayElement {{*}}readsHoleAsNaN
// # RUN(HOLES): walk f2 mechanisms=all
// # HOLES-LABEL: code f2:Body
// # HOLES-NOT: readsHoleAsNaN
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sum(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]!; return s; }
function holes(list: number[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (x === undefined) n += 100; else n += x; } return n; }
const whole: number[] = [];
const holed: number[] = [];
for (let k = 0; k < 12; k++) { whole.push(k + 0.5); holed.push(k + 0.5); }
delete holed[3];
report(sum(whole)); report(String(sum(holed))); report(holes(whole)); report(holes(holed));
holed[3] = 1.5;
report(sum(holed)); report(holes(holed));
report("end");
