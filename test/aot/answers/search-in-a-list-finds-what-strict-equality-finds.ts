// answers: without-library
// # a search for a number, an object or undefined compares words, among texts too. A search for a text compares characters, of a rope as of a flat text
// # f1 = find, f2 = findText, f3 = findMixed, f4 = findObject, f5 = findHole, f6 = tell
// # the search for a number ends its block (TryCallInline), and the end of a block prints no traits. It stands under a handler, so that what it may do shows: it throws nothing, so its block leads no edge to the handler. The call behind the miss does
// # RUN(FORM): walk f1 mechanisms=all-Inlining-ParameterGuards
// # FORM-LABEL: code f1:Body
// # FORM-NOT: handler=
// # FORM: TryCallInline {{*}}inlineBuiltin=ArrayIndexOf
// # FORM: handler=
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const key = { id: 1 };
function find(n: unknown) { const xs = [1, 2, 3, -0, NaN]; try { return typeof n === "number" ? xs.indexOf(n) * 10 + (xs.includes(n) ? 1 : 0) : "none"; } catch { return "thrown"; } }
function findText(s: unknown) { const xs = ["a", "bc", "1"]; return typeof s === "string" ? xs.indexOf(s) : "none"; }
function findMixed(n: unknown) { const xs: unknown[] = ["1", 1, key, null]; return typeof n === "number" ? xs.indexOf(n) : "none"; }
function findObject(o: object) { const xs: unknown[] = ["[object Object]", key, { id: 1 }]; return xs.indexOf(o); }
function findHole(n: unknown) { const xs = [1, , 3]; return typeof n === "undefined" ? String(xs.indexOf(n as any)) + String(xs.includes(n as any)) : "none"; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => find(2));
tell(() => find(0));
tell(() => find(NaN));
tell(() => find(7));
tell(() => findText("b" + "c"));
tell(() => findText("d"));
tell(() => findMixed(1));
tell(() => findObject(key));
tell(() => findObject({ id: 1 }));
tell(() => findHole(undefined));
report("end");
