// answers: with-library
// # Two views are read and stored into under a counter whose bound is a written number. The lesser of the bound and of the rooms is asked at the head, and both accesses of the typed build stand without a test of their own.
// # The comparison names the written number in one form and the arm that brings it names it in another: they are one number.
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-COUNT-2: isInsideView
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function copy(a: Float64Array, b: Float64Array): number { for (let i = 0; i < 16; i++) { a[i] = b[i]! + 1; } return a[3]!; }
const whole = new Float64Array(16), given = new Float64Array(16), short = new Float64Array(8);
for (let at = 0; at < 16; at++) given[at] = at;
report(copy(id(whole), id(given)));
report(copy(id(short), id(given)));
report(short.join());
report(copy(id(whole), id(short)));
report(whole.join());
report("end");
