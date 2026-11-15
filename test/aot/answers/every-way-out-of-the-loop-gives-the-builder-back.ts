// answers: without-library
// # the loop of a growing text is left by its test, a break, a return, a throw and the continue of a loop around, with the text read behind the way out and not. More builders are begun than the pool holds
// # f2 = left, f3 = returned, f4 = dead, f5 = rows, f1 = thrown, f6 = older, f7 = tell
// # RUN(FORM): walk f2 f3 f4 f5 f1 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: StringBuilderFinish
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderFinish
// # FORM-LABEL: code f4:Body
// # FORM: StringBuilderDiscard
// # FORM-LABEL: code f5:Body
// # FORM: StringBuilderBegin
// # FORM-LABEL: code f1:Body
// # FORM: StringBuilderFinish
// # RUN(NOFORM): walk f6 mechanisms=all
// # NOFORM-NOT: StringBuilder
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 21 of 21 of 21
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function left(n: number, stop: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) break; } return s; }
function returned(n: number, stop: number) { let s = "<"; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) return s + ">"; } return s; }
function dead(n: number) { let s = ""; let i = 0; for (; i < n; i++) s += "x" + i; return i; }
function rows(n: number, stop: number) { let out = ""; outer: for (let i = 0; i < n; i++) { let s = ""; for (let j = 0; j < n; j++) { s += "x" + j; if (j === stop + i) continue outer; } out = out + s + ";"; } return out; }
function thrown(n: number, stop: number) { let s = "!"; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) throw s; } return s; }
function older(n: number, stop: number) { let s = ""; let before = ""; for (let i = 0; i < n; i++) { before = s; s += "k" + i; if (i === stop) return before + "|" + s; } return before + "/" + s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("caught " + e); } }
report(left(0, 9));
report(left(5, 9));
report(left(5, 2));
report(left(5, 0));
report(returned(0, 9));
report(returned(5, 9));
report(returned(5, 3));
report(dead(0));
report(dead(6));
report(rows(0, 0));
report(rows(3, 9));
report(rows(4, 1));
report(rows(4, 0));
tell(() => thrown(4, 9));
tell(() => thrown(4, 2));
tell(() => thrown(4, 0));
report(older(0, 9));
report(older(4, 9));
report(older(4, 2));
let turns = 0;
for (let k = 0; k < 60; k++) turns += dead(k) + left(k, 3).length + returned(k, 5).length;
report(turns);
report("end");
