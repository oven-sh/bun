// answers: with-library
// # `const v = 1 * list[i]; .. if (list[i] === undefined) h++`: the first read takes NaN for a hole, since the product is its one user; the walk folds `1 *`, and the read's record stands for `v`. The second read of the same place is another read of the program: it finds the hole.
// # Where the build verifies, the walk holds behind each read of an element that the record it is bound to, if that takes NaN for a hole, was made for this very read: behind a fold the verifier excuses whoever takes the record, so nobody else could tell a second reader.
// # OPTIONS: check=Validate
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function a(list: number[]): string { let s = 0, h = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[i]!; if (v === v) s += v; if (list[i] === undefined) h++; } return s + ":" + h; }
function b(list: number[]): string { let n = 0, h = 0; for (let i = 0; i < list.length; i++) { if (list[i] === undefined) h++; const v = 1 * list[i]!; if (v !== v) n++; } return n + ":" + h; }
function c(list: number[]): string { let i = 0, n = 0, h = 0; for (const x of list) { const v = 1 * x; if (v !== v) n++; if (typeof list[i] === "undefined") h++; i++; } return n + ":" + h; }
function d(list: number[], k: number): string { let n = 0, h = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[k]!; if (v !== v) n++; if (((list[k] as number | undefined) ?? 7) === 7) h++; } return n + ":" + h; }
function e(list: number[]): number { const zero = 0; let t = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[i]!, w = list[i]! - zero; t += (v !== v ? 1 : 0) + (w !== w ? 1 : 0) + (String(list[i]) === "undefined" ? 1 : 0); } return t; }
function f(list: number[]): string { let h = 0; for (let i = 0; i < list.length; i++) { const v = 1 * list[i]!; if (v !== v) list[i] = 9.5; if (list[i] === 9.5) h++; } return h + ":" + (2 in list); }
const F: number[] = [];
for (let k = 0; k < 6; k++) F.push(k + 0.5);
F[4] = -0;
delete F[2];
report(a(F));
report(b(F));
report(c(F));
report(d(F, 2));
report(e(F));
report(f(F.slice()));
report("end");
