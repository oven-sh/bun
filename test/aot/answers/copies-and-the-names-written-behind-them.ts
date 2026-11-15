// answers: without-library
// # the copy and the names behind it as one operation give what the operations one by one give, whatever the source is: a record of the program, an object out of JSON.parse, a primitive, a list, a proxy, one with getters, one that throws. The getters run in front of every definition
// # f1 = named, f2 = both.
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = CopyObjectAndDefine
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 72 of 72 of 72
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function named(o: any, v: unknown) { return { ...o, name: v, size: 1 }; }
function both(a: any, b: any) { return { ...a, ...b }; }
function three(a: any, b: any, c: any) { return { ...a, ...b, ...c }; }
function twice(o: any, v: unknown, key: string) { return { ...o, name: v, [key]: "last" }; }
function typed(o: any) { const made = { ...o, name: 1 }; return made.name + (made.a ?? 0); }
function show(o: any) { let s = ""; for (const k in o) s += k + "=" + String(o[k]) + ";"; return s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function record() { return { a: 1, b: 2 }; }
function withGetter(log: string[]) { return { get a() { log[0] += "a"; return 1; }, get name() { log[0] += "n"; return "source"; } }; }
function all(o: any) { tell(() => show(named(o, "v"))); tell(() => show(both(o, { z: 1 }))); tell(() => show(both({ z: 1, a: 0 }, o))); tell(() => show(three(o, undefined, o))); tell(() => show(twice(o, "v", "name"))); tell(() => typed(o)); }
all(record());
all(JSON.parse("{\"a\":5,\"name\":\"parsed\",\"q\":6}"));
all({});
all(null);
all(undefined);
all("xy");
all(7);
all([8, 9]);
all(new Proxy({ a: 1, name: "behind" }, {}));
all(Object.create({ inherited: 1 }));
all(Object.freeze({ a: 3, name: "frozen" }));
tell(() => { const log = [""]; const made = named(withGetter(log), "v"); return show(made) + log[0]; });
tell(() => { const made: any = named(record(), "v"); made.a = 50; made.extra = 1; return show(made) + show(record()); });
tell(() => { const made: any = named(record(), "v"); return String(Object.getPrototypeOf(made) === Object.prototype) + String(Object.isFrozen(named(Object.freeze({ a: 1 }), 2))); });
tell(() => show(named({ get boom() { throw new RangeError("boom"); } }, "v")));
tell(() => { let s = ""; for (let i = 0; i < 300; i++) s = show(named(i % 2 ? record() : JSON.parse("{\"q\":1}"), i)); return s; });
report("end");
