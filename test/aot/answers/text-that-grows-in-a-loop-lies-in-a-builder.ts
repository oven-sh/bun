// answers: without-library
// # the string that comes out of the builder is the one that the joins give: no turn, one turn, many. Beside it the shapes that get no builder, and the text that is a part of its own growth
// # f1 = grow, f2 = forked, f3 = prepended, f4 = doubled, f5 = wrapped
// # RUN(FORM): walk f1 f5 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderFinish
// # FORM-LABEL: code f5:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # RUN(NOFORM): walk f2 f3 f4 mechanisms=all
// # NOFORM-NOT: StringBuilder
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function grow(n: number) { let text = "a"; for (let i = 0; i < n; i++) text = text + "k" + i; return text; }
function forked(n: number) { let text = "a"; let before = "a"; for (let i = 0; i < n; i++) { before = text; text = text + "k" + i; } return before + "|" + text; }
function prepended(n: number) { let text = "a"; for (let i = 0; i < n; i++) text = i + "k" + text; return text; }
function doubled(n: number) { let text = "ab"; for (let i = 0; i < n; i++) text += text; return text; }
function wrapped(n: number) { let text = "a"; for (let i = 0; i < n; i++) text += "<" + text + ">"; return text; }
report(grow(0));
report(grow(1));
report(grow(12));
report(grow(700).length);
report(grow(700).slice(-9));
report(forked(0));
report(forked(1));
report(forked(4));
report(prepended(4));
report(doubled(3));
report(wrapped(0));
report(wrapped(3));
report(grow(3) === "ak0k1k2");
report(typeof grow(2));
report("end");
