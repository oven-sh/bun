// answers: without-library
// # what enters the loop is no text and is only joined: 0, -0, a fraction, undefined, a boolean. Where the loop may have no turn, or a turn looks at the value, or the sum may be a number, the value stays what it is
// # f1 = numbered, f2 = negative, f3 = fraction, f4 = nothing, f5 = flag, f6 = maybeNoTurn, f7 = seen, f8 = summed
// # RUN(FORM): walk f1 f2 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderFinish
// # FORM-LABEL: code f2:Body
// # FORM: StringBuilderBegin
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderBegin
// # RUN(NOFORM): walk f6 mechanisms=all
// # NOFORM-NOT: StringBuilder
// # RUN(SEEN): walk f7 mechanisms=all
// # SEEN-COUNT-1: StringBuilderBegin
// # SEEN-NOT: StringBuilderBegin
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 18 of 18 of 18
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function numbered(n: number) { let text: any = 0; let i = 0; do text += "k"; while (++i < n); return text; }
function negative(n: number) { let text: any = -0; let i = 0; do text += "k"; while (++i < n); return text; }
function fraction(n: number) { let text: any = 1.5; let i = 0; do text += "k" + i; while (++i < n); return text; }
function nothing(n: number) { let text: any = undefined; let i = 0; do text += "k"; while (++i < n); return text; }
function flag(n: number) { let text: any = true; let i = 0; do text += "k"; while (++i < n); return text; }
function maybeNoTurn(n: number) { let text: any = 0; for (let i = 0; i < n; i++) text += "k"; return text; }
function seen(n: number) { let text: any = 0; let kinds = ""; let i = 0; do { kinds = kinds + typeof text + ","; text += "k"; } while (++i < n); return kinds + text; }
function summed(x: any, n: number) { let text: any = 0; let i = 0; do text += x; while (++i < n); return text; }
report(numbered(1));
report(numbered(3));
report(typeof numbered(1));
report(negative(1));
report(negative(2));
report(fraction(2));
report(nothing(2));
report(flag(2));
report(maybeNoTurn(0));
report(typeof maybeNoTurn(0));
report(maybeNoTurn(2));
report(typeof maybeNoTurn(2));
report(seen(3));
report(summed(2, 3));
report(typeof summed(2, 3));
report(summed("a", 3));
report(summed(null, 2));
report("end");
