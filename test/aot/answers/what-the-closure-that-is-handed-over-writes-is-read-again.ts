// answers: without-library
// # a callee that calls its parameter does what the one closure does that this call hands it, and a call of one of two functions does what the two do: what they write is read again behind the call
// # f1 = each, f2 = mark, f3 = clear, f4 = fail, f5 = run, f6 = reset, f7 = failing, f8 = either, f9 = any, f10 = tell
// # `report` is handed to `each` too. Link leaves the calls of a parameter out, for whoever knows what he hands over, only where something arrives there that nobody has seen: closures of the program alone are lost functions, whose effects it unites
// # RUN(FORM): walk f5 mechanisms=all-Inlining
// # FORM-LABEL: code f5:Body
// # FORM: = CallDirect {{*}}function=f1
// # RUN(QUIET): walk f5 mechanisms=all-Inlining
// # QUIET-NOT: = CallDirect {{*}}function=f1{{*}}mayCallUnknownCode
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=all-Inlining $SHELL
// # ALSO1: 14 of 14 of 14
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let marks = 0;
function each(f: () => void) { f(); f(); }
function mark() { marks = (marks + 1) | 0; }
function clear() { marks = 0; }
function fail() { marks = 9; throw "failed"; }
function run() { const before = marks; each(mark); return before * 10 + marks; }
function reset() { const before = marks; each(clear); return before * 10 + marks; }
function failing() { const before = marks; try { each(fail); } catch (e) { return String(e) + before + marks; } return "none"; }
function either(flag: boolean) { const before = marks; const f = flag ? mark : clear; f(); return before * 10 + marks; }
function any(f: () => void) { const before = marks; each(f); return before * 10 + marks; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("threw " + String(e)); } }
tell(() => run());
tell(() => run());
tell(() => reset());
tell(() => run());
tell(() => failing());
tell(() => either(true));
tell(() => either(false));
tell(() => either(true));
tell(() => any(() => { marks = 5; }));
tell(() => any(null as any));
tell(() => any(report as any));
report("end");
