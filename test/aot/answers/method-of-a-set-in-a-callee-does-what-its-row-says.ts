// answers: without-library
// # a callee calls add on a set that its caller has made and nobody else has: the name finds what the table lists, and the one row of add says what the call does
// # f1 = note
// # Since Link's effects lean on no site of a set that comes through a parameter, note() is any code to its caller; the answers are what is held.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function note(seen: Set<number>, k: number) { seen.add(k); }
function mark(box: { n: number }) { const seen = new Set<number>(); const before = box.n; note(seen, 1); note(seen, 1); note(seen, 2); return before * 100 + box.n * 10 + seen.size; }
report(mark({ n: 2 }));
report("end");
