// answers: without-library
// # a read and two questions under the key of a for-in, on the object that is enumerated, stand behind one test of the enumerator: ordinary objects, compiled ones, what stands below another object, getters, traps, and an object that a turn changes between the step and the use
// # f1 = sum, f2 = has, f3 = owns, f4 = changed, f5 = other, f11 = tell
// # RUN(FORM): walk f1 f2 f3 f4 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = EnumeratorGetByVal
// # FORM-LABEL: code f2:Body
// # FORM: = IsEnumeratorCurrent
// # FORM-LABEL: code f3:Body
// # FORM: = IsEnumeratorCurrent
// # FORM-LABEL: code f4:Body
// # FORM: = EnumeratorGetByVal
// # RUN(OTHER): walk f5 mechanisms=all
// # OTHER-NOT: EnumeratorGetByVal
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sum(o: any) { let text = ""; for (const k in o) text += k + "=" + o[k] + ","; return text; }
function has(o: any) { let text = ""; for (const k in o) text += k + (k in o ? "+" : "-"); return text; }
function owns(o: any) { let text = ""; for (const k in o) text += k + (Object.hasOwn(o, k) ? "+" : "-"); return text; }
function changed(o: any, change: (o: any, k: string) => void) { let text = ""; for (const k in o) { change(o, k); text += k + "=" + o[k] + (k in o ? "+" : "-") + (Object.hasOwn(o, k) ? "+" : "-") + ","; } return text; }
function other(o: any, p: any) { let text = ""; for (const k in o) text += k + "=" + p[k] + (k in p ? "+" : "-") + ","; return text; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
class Pair { first = 1; second = 2; }
function below() { const o = Object.create({ up: "above", a: "hidden" }); o.a = 1; o.b = 2; return o; }
function getters() { let n = 0; return { get a() { return ++n; }, b: 2, get c() { return ++n; } }; }
function trapped() { return new Proxy({ a: 1, b: 2 }, { get(t: any, k) { return t[k] * 10; }, has(t, k) { return k === "a"; } }); }
function many() { const o: any = {}; for (let i = 0; i < 40; i++) o["n" + i] = i; return o; }
function same(o: any) { let text = ""; for (const k in o) text += Object.is(o, k) ? "+" : "-"; return text; }
tell(() => sum({ a: 1, b: 2, c: 3 }));
tell(() => sum(new Pair()));
tell(() => sum(JSON.parse('{"x":1,"y":"two","z":null}')));
tell(() => sum(below()));
tell(() => sum(getters()));
tell(() => sum(trapped()));
tell(() => sum(many()));
tell(() => sum([5, 6]));
tell(() => sum("ab"));
tell(() => sum(undefined));
tell(() => has({ a: 1, b: undefined }));
tell(() => has(below()));
tell(() => has(trapped()));
tell(() => has(JSON.parse('{"x":1,"y":2}')));
tell(() => owns({ a: 1, b: undefined }));
tell(() => owns(below()));
tell(() => owns(new Pair()));
tell(() => owns(JSON.parse('{"x":1,"y":2}')));
tell(() => changed({ a: 1, b: 2, c: 3 }, () => {}));
tell(() => changed({ a: 1, b: 2, c: 3 }, (o, k) => { if (k === "b") delete o.b; }));
tell(() => changed({ a: 1, b: 2, c: 3 }, (o, k) => { if (k === "b") Object.defineProperty(o, "b", { get() { return "got"; }, enumerable: true, configurable: true }); }));
tell(() => changed({ a: 1, b: 2, c: 3 }, (o, k) => { if (k === "a") o.z = 26; }));
tell(() => changed(JSON.parse('{"a":1,"b":2,"c":3}'), (o, k) => { if (k === "a") { delete o.a; o.a = "again"; } }));
tell(() => changed(JSON.parse('{"a":1,"b":2,"c":3}'), (o, k) => { if (k === "b") { delete o.b; Object.setPrototypeOf(o, { b: "above" }); } }));
tell(() => other({ a: 1, b: 2 }, { b: "p" }));
tell(() => other({ a: 1, b: 2 }, JSON.parse('{"a":"q"}')));
tell(() => same({ a: 1, b: 2 }));
report("end");
