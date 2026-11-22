// answers: without-library
// # a callee spreads what it is handed, and on one such object the program has laid a getter behind its making: the copy reads the property, the getter writes a field of another object, and the caller reads that field before and behind the call
// # the layout is none of plain objects, so the callee may run code that nobody knows. Where it is taken for one, the caller keeps what it has read and answers 92 in the place of 192
// # f1 = clone
// # RUN(FORM): link functions mechanisms=all
// # FORM: function f1 {{*}}mayCallUnknownCode
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const holder = { n: 0 };
function clone(s: { a: number; b: number }) { return { ...s }; }
function hostile() { const o = { a: 1, b: 2 }; Object.defineProperty(o, "a", { get() { holder.n = holder.n + 1; return 9; }, enumerable: true }); return o; }
function outer(s: { a: number; b: number }) { const before = holder.n; const made = clone(s); return before * 1000 + holder.n * 100 + made.a * 10 + made.b; }
function inLoop(s: { a: number; b: number }) { let t = 0; for (let i = 0; i < 3; i++) { clone(s); t = t * 10 + holder.n; } return t; }
report(outer({ a: 1, b: 2 }));
report(outer(hostile()));
report(inLoop(hostile()));
report("end");
