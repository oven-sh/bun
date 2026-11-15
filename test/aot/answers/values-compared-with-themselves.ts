// answers: without-library
// # only NaN differs from itself: a comparison of a value with itself is folded where a name of the value says that it is no number, and is made wherever NaN may come
// # f1 = same, f6 = made. In `same` the front end names the parameter itself on both sides, behind the join of the two tests that `typeof v === "object"` is, so no name says what the tests have found and the comparison is made. In `made` the allocation says it
// # RUN(FORM): walk f6 mechanisms=all
// # FORM-LABEL: code f6:Body
// # FORM-NOT: StrictEq
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 69 of 69 of 69
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let kept: unknown = null;
function same(v: unknown) { return typeof v === "object" ? v === v : "other"; }
function text(v: unknown) { return typeof v === "string" ? v === v : "other"; }
function any(v: unknown) { return v === v; }
function number(v: unknown) { return typeof v === "number" ? v === v : "other"; }
function differs(v: unknown) { return typeof v === "object" ? v !== v : "other"; }
function made(v: unknown) { const o = { v }; kept = o; return o === o; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function all(v: unknown) { tell(() => same(v)); tell(() => text(v)); tell(() => any(v)); tell(() => number(v)); tell(() => differs(v)); }
all({});
all(null);
all(NaN);
all(0);
all(-0);
all(1.5);
all("a");
all("");
all(undefined);
all(true);
all(Symbol.iterator);
all([NaN]);
all(0 / 0);
tell(() => made(1));
tell(() => made(NaN));
tell(() => kept !== null);
report("end");
