// answers: without-library
// # the body of a loop over a list throws, and a try around the loop in the same function catches it
// # the twin of programs/tail-calls/loop-over-a-list-whose-body-throws-under-a-try.ts, made by integration/tests/program-to-answers.py: the test of a `sound` control is an .ir; the program stands beside it
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function walk(list: number[], limit: number): string { let seen = ""; try { for (const v of list) { seen += v; if (v === limit) throw new Error("at " + v); } } catch (e) { return seen + "!" + (e as Error).message; } return seen; }
function deed(limit: number) { return walk([1, 2, 3], limit); }
report(String(deed(9)));
for (let i = 0; i < 5; i++) report(String(deed(i)));
report(String(deed(9)));
report("end");
