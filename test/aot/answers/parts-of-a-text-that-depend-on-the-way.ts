// answers: without-library
// # a part that depends on the way: in front of other parts and behind them, a sum of numbers that is no join, three ways, an empty part, the length read round it, and a part behind it or on one way that runs code
// # f3 = marks, f4 = tailed, f5 = headed, f6 = summed, f7 = three, f8 = empty, f9 = measured, f1 = withCode, f2 = chosen, f10 = tell
// # RUN(FORM): walk f3 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderAppendConstant {{*}}string="a"
// # FORM: StringBuilderAppendConstant {{*}}string="bb"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 24 of 24 of 24
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 24 of 24 of 24
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function marks(n: number) { let s = ""; for (let i = 0; i < n; i++) s += i % 2 ? "a" : "bb"; return s; }
function tailed(n: number) { let s = ""; for (let i = 0; i < n; i++) s += (i % 2 ? "a" : i) + "!"; return s; }
function headed(n: number) { let s = ""; for (let i = 0; i < n; i++) s += "<" + (i % 2 ? "a" : "bb"); return s; }
function summed(n: number) { let s = ""; for (let i = 0; i < n; i++) s += (i % 2 ? 1 : i) + 2; return s; }
function three(n: number) { let s = ">"; for (let i = 0; i < n; i++) s += i % 3 === 0 ? "zero" : i % 3 === 1 ? 1.5 : null; return s; }
function empty(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += i % 2 ? "" : "x"; if (!s) s += "?"; } return s + s.length; }
function measured(n: number) { let s = ""; let seen = ""; for (let i = 0; i < n; i++) { const p = i % 2 ? "a" : "bb"; seen += s.length; s += p; seen += ":" + s.length + " "; } return seen + s; }
function withCode(x: any, n: number) { let s = ""; for (let i = 0; i < n; i++) s += (i % 2 ? "a" : "b") + x; return s; }
function chosen(x: any, n: number) { let s = ""; for (let i = 0; i < n; i++) s += i % 2 ? x : "-"; return s; }
function tell(f: () => unknown) { log = ""; try { report(f()); } catch (e) { report("threw " + e); } report(log); }
for (let n = 0; n < 5; n++) report(marks(n));
report(tailed(5));
report(headed(4));
report(summed(4));
report(three(7));
report(empty(4));
report(measured(4));
tell(() => withCode("t", 3));
tell(() => withCode({ toString() { log += "s"; return "T"; } }, 3));
tell(() => withCode({ toString() { log += "s"; throw "stop"; } }, 3));
tell(() => chosen("t", 4));
tell(() => chosen({ toString() { log += "s"; return "T"; } }, 4));
tell(() => chosen(7, 4));
report("end");
