// answers: without-library
// # what a handler reads of a text that grows is the text at the throw, at each turn in which the throw can come: behind the loop, in the loop, through a finally, out of a loop inside. And a text that goes from loop to loop
// # f1 = pass, f2 = caught, f3 = begunInFront, f4 = dead, f5 = kept, f6 = keptAndRead, f7 = leftFromCatch, f8 = nested, f9 = cleaned, f10 = two, f11 = three, f12 = readBetween, f13 = secondMayNotRun
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: = StringBuilderBegin
// # RUN(INSIDE): walk f5 mechanisms=all
// # INSIDE-LABEL: code f5:Body
// # INSIDE: = StringBuilderBegin
// # RUN(TWO): walk f10 mechanisms=all
// # TWO-LABEL: code f10:Body
// # TWO: StringBuilderBegin
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 50 of 50 of 50
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 50 of 50 of 50
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function pass(i: number, bad: number) { if (i === bad) throw "bad" + i; return i; }
function caught(n: number, bad: number) { let s = ""; try { for (let i = 0; i < n; i++) s += "k" + pass(i, bad) + ","; } catch (e) { return "caught " + e + " with " + s; } return s; }
function begunInFront(n: number, bad: number) { let s = "head:"; try { pass(0, bad - 100); for (let i = 0; i < n; i++) { s += pass(i, bad); s += ";"; } pass(1, bad - 200); } catch (e) { s += "!" + e; } return s; }
function dead(n: number, bad: number) { try { let s = ""; for (let i = 0; i < n; i++) s += pass(i, bad) + ","; return s; } catch (e) { return "no text, " + e; } }
function kept(n: number, bad: number) { let s = ""; let misses = 0; for (let i = 0; i < n; i++) { try { s += pass(i, bad); } catch { misses++; } } return s + "/" + misses; }
function keptAndRead(n: number, bad: number) { let s = ""; let seen = ""; for (let i = 0; i < n; i++) { try { s += "<" + pass(i, bad) + ">"; } catch { seen += s.length + "|" + s + "|"; } } return s + "/" + seen; }
function leftFromCatch(n: number, bad: number) { let s = ""; for (let i = 0; i < n; i++) { try { s += pass(i, bad); } catch { return "left with " + s; } } return s; }
function nested(n: number, bad: number) { let s = ""; try { for (let r = 0; r < n; r++) { for (let c = 0; c < 3; c++) s += pass(r * 3 + c, bad); s += "/"; } } catch (e) { return s.length + ":" + s; } return s; }
function cleaned(n: number, bad: number) { let s = ""; let ends = 0; try { for (let i = 0; i < n; i++) { try { s += pass(i, bad) + "."; } finally { ends++; } } } catch (e) { return s + "/" + ends + "/" + e; } return s + "/" + ends; }
function two(n: number, m: number) { let s = ""; for (let i = 0; i < n; i++) s += i; for (let j = 0; j < m; j++) s += "-" + j; return s; }
function three(n: number) { let s = "a"; for (let i = 0; i < n; i++) s += i; for (let j = 0; j < n; j++) s += "b"; for (let k = 0; k < n; k++) s += k; return s + s.length; }
function readBetween(n: number) { let s = ""; for (let i = 0; i < n; i++) s += i; const between = s; for (let j = 0; j < n; j++) s += j; return between + "/" + s; }
function secondMayNotRun(n: number, again: boolean) { let s = ""; for (let i = 0; i < n; i++) s += i; if (again) { for (let j = 0; j < n; j++) s += "x"; } return s; }
for (let bad = -1; bad < 5; bad++) report(caught(4, bad));
for (let bad = -1; bad < 4; bad++) report(begunInFront(3, bad));
report(begunInFront(3, 100));
report(begunInFront(3, 201));
for (let bad = -1; bad < 3; bad++) report(dead(3, bad));
for (let bad = -1; bad < 4; bad++) report(kept(4, bad));
for (let bad = -1; bad < 4; bad++) report(keptAndRead(4, bad));
for (let bad = -1; bad < 4; bad++) report(leftFromCatch(4, bad));
for (let bad = -1; bad < 7; bad += 2) report(nested(2, bad));
for (let bad = -1; bad < 3; bad++) report(cleaned(3, bad));
report(two(0, 0));
report(two(3, 0));
report(two(0, 3));
report(two(3, 3));
report(three(0));
report(three(2));
report(readBetween(3));
report(secondMayNotRun(3, false));
report(secondMayNotRun(3, true));
report("end");
