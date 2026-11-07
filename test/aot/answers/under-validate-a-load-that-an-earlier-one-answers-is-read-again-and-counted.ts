// answers: with-library
// # Two stores and two reads of one list stand in one block of a nest of loops, and the two positions may meet. The machine's numbering may answer a load by an earlier load of the same word only where no store between them reaches it.
// # Where the build validates, every load that is answered so is read again and held against the earlier one; where they differ the program stops and says so. The counter shows that the run was armed.
// # OPTIONS: check=Validate
// # STATISTIC: LoadsReadAgainBehindNumbering >= 1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function meet(a: number[]): number { let s = 0; for (let j = 0; j < a.length; j++) for (let i = 0; i < a.length; i++) { a[j] = (i + 1) | 0; s = s + a[i]!; a[j] = (i + 2) | 0; s = s + a[i]!; } return s; }
function twice(x: number[], y: number[]): number { let s = 0; for (let i = 0; i < x.length; i++) { if (i >= y.length) break; y[i] = (i + 1) | 0; s = s + x[i]!; y[i] = (i + 2) | 0; s = s + x[i]!; } return s; }
const first: number[] = [];
const second: number[] = [];
for (let i = 0; i < 8; i++) { first.push(i); second.push(i); }
report(meet(first));
report(twice(second, second));
report("end");
