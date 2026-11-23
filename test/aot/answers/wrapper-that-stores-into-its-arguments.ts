// answers: without-library
// # a wrapper stores into its arguments object in front of handing it on
// # the twin of programs/tail-calls/wrapper-that-stores-into-its-arguments.ts, made by integration/tests/program-to-answers.py: the test of a `sound` control is an .ir; the program stands beside it
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function target(this: unknown, ...values: unknown[]): string { return values.length + "/" + values.join(); }
function wrap(this: unknown, a?: unknown, b?: unknown): string { arguments[0] = 9; return target.apply(this, arguments as any) + "/" + a; }
function tail(this: unknown, a?: unknown, b?: unknown): string { arguments[1] = 8; return target.apply(this, arguments as any); }
function deed(count: number): string { if (count === 0) return wrap() + " " + tail(); if (count === 1) return wrap(1) + " " + tail(1); if (count === 2) return wrap(1, 2) + " " + tail(1, 2); return (wrap as any)(1, 2, 3) + " " + (tail as any)(1, 2, 3); }
report(String(deed(2)));
for (let i = 0; i < 4; i++) report(String(deed(i)));
report(String(deed(1)));
report("end");
