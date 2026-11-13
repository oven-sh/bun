// answers: without-library
// # the position of a for-in and the number of names that are current come round in registers: the keys are those of the language, whatever is enumerated and whatever a turn does to it
// # f1 = count, f2 = names, f3 = changing, f4 = skipping, f5 = nothing, f9 = tell
// # RUN(FORM): walk f1 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = ForInOpenCountingNames
// # FORM-LABEL: code f3:Body
// # FORM: = ForInOpenCountingNames
// # RUN(CELL): walk f1 f2 f3 f4 f5 mechanisms=all
// # CELL-NOT: NewHeapWords
// # RUN(NOTHING): walk f5 mechanisms=all
// # NOTHING-NOT: ForInOpen
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 23 of 23 of 23
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function count(o: unknown) { let n = 0; for (const k in o as any) n++; return n; }
function names(o: unknown) { let text = ""; for (const k in o as any) text += k + ","; return text; }
function changing(o: any) { let text = ""; for (const k in o) { text += k; if (k === "a") { delete o.b; o.z = 1; } } return text; }
function skipping(o: any) { let text = ""; for (const k in o) { if (k === "b") continue; if (k === "d") break; text += k; } return text; }
function nothing() { let n = 0; for (const k in undefined as any) n++; for (const k in null as any) n++; return n; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
class Pair { first = 1; second = 2; method() { return 0; } }
function below() { const o = Object.create({ up: 1, a: 0 }); o.a = 1; o.b = 2; return o; }
function hidden() { const o: any = { a: 1, b: 2, c: 3 }; Object.defineProperty(o, "b", { enumerable: false }); return o; }
function trapped() { return new Proxy({ a: 1, b: 2 }, { ownKeys() { return ["b", "a"]; } }); }
tell(() => count({ a: 1, b: 2, c: 3 }));
tell(() => count({}));
tell(() => count(undefined));
tell(() => count(null));
tell(() => count(7));
tell(() => count("abc"));
tell(() => count([4, 5]));
tell(() => count(new Pair()));
tell(() => names({ a: 1, b: 2, c: 3 }));
tell(() => names({ b: 1, a: 2, 1: 3, 0: 4 }));
tell(() => names(new Pair()));
tell(() => names(below()));
tell(() => names(hidden()));
tell(() => names(trapped()));
tell(() => names("ab"));
tell(() => names([7, , 9]));
tell(() => names(JSON.parse('{"x":1,"y":{"z":2}}')));
tell(() => changing({ a: 1, b: 2, c: 3 }));
tell(() => changing({ c: 1, a: 2, b: 3, d: 4 }));
tell(() => changing(JSON.parse('{"a":1,"b":2,"c":3}')));
tell(() => skipping({ a: 1, b: 2, c: 3, d: 4, e: 5 }));
tell(() => nothing());
report("end");
