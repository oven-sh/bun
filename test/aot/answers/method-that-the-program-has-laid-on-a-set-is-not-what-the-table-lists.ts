// answers: without-library
// # the program has laid a function of its own under `add` on the set that the callee is handed: something lies under unknown names, so the members of the instance are not taken to be as the table lists them, and the lookup may find anything
// # a set and not a list: add has one row, so nothing behind the lookup refuses the call a second time
// # f1 = note
// # RUN(FORM): link functions mechanisms=all
// # FORM: function f1 {{*}}mayCallUnknownCode
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const holder = { n: 0 };
function note(seen: Set<number>, k: number) { seen.add(k); }
function hostile() { const seen = new Set<number>(); (seen as any).add = function (k: number) { holder.n = holder.n + k; return seen; }; return seen; }
function outer(seen: Set<number>) { const before = holder.n; note(seen, 5); return before * 100 + holder.n * 10 + seen.size; }
report(outer(hostile()));
report("end");
