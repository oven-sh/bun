// answers: without-library
// # a callee whose answer nobody takes subtracts and compares what it is handed: numbers, a BigInt beside a number (it throws), an object that converts (its code runs), texts, a symbol (it throws)
// # the form is that of minus() and less(), whichever numbers they have
// # RUN(FORM): summary
// # FORM: summary {{*}}operators=[
// # FORM: operands-of-operators Parameter
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const holder = { n: 0 };
function minus(a: any, b: any) { return a - b; }
function less(a: any, b: any) { return a < b; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("threw at " + holder.n); } }
function withNumbers() { holder.n = 1; minus(3, 1); holder.n = 2; return holder.n; }
function withBigInt() { holder.n = 1; minus(3, 1n); holder.n = 2; return holder.n; }
function withObject() { holder.n = 1; const before = holder.n; minus({ valueOf() { holder.n = 9; return 1; } }, 1); return before * 10 + holder.n; }
function withTexts() { holder.n = 1; const before = holder.n; const answer = less("a", "b"); return String(answer) + before + holder.n; }
function withSymbol() { holder.n = 1; less(Symbol.iterator, 1); holder.n = 2; return holder.n; }
tell(withNumbers);
tell(withBigInt);
tell(withObject);
tell(withTexts);
tell(withSymbol);
report("end");
