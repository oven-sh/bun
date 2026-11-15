// answers: with-library
// # `const v = 1 * list[i]` and `const v = -0 + list[i]`: the read takes NaN for a hole, the walk folds the arithmetic, and the read's record stands for `v`. Whoever takes `v` takes what the program's own arithmetic made: a sum, a comparison, a text.
// # Where the build verifies, the walk notes the record that a fold gives, and the verifier excuses whoever takes a read through it. It went by whether some arithmetic of the finished code takes the read: `s += v` made it hold the others, and right builds stopped.
// # OPTIONS: check=Validate
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function joined(list: number[]): string { let s = 0, m = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[i]!; s += v; if (v > m) m = v; } return m + ":" + s; }
function apart(list: number[]): string { let s = 0, n = 0, z = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[i]!; if (v !== v) n++; else if (Object.is(v, -0)) z++; else s += v; } return s + ":" + n + ":" + z; }
function beside(list: number[]): string { let s = 0, n = 0, z = 0; for (let i = 0; i < list.length; i++) { const v = -0 + list[i]!; if (v !== v) n++; else if (Object.is(v, -0)) z++; else s += v; } return s + ":" + n + ":" + z; }
const whole: number[] = [];
const holed: number[] = [];
for (let k = 0; k < 8; k++) { whole.push(k + 0.5); holed.push(k + 0.5); }
delete holed[7];
holed[2] = -0;
report(joined(whole));
report(joined(holed));
report(apart(whole));
report(apart(holed));
report(beside(whole));
report(beside(holed));
report("end");
