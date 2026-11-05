// answers: without-library
// # an accessor under a computed key that is one name is defined by the name: the order of the keys, the descriptor, an index, `__proto__` as a computed key, a key that a call gives, and a name that the literal has laid already
// # f1 = note, f2 = named, f3 = pair, f4 = indexed, f5 = proto, f6 = computed, f7 = ordered, f8 = over, f9 = keysOf, f10 = describe, f11 = tell
// # RUN(FORM): walk f2 mechanisms=none+TypedOperations
// # FORM-LABEL: code f2:Body
// # FORM: DefineGetter {{*}}key="size"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none+TypedOperations $SHELL
// # ALSO1: 20 of 20 of 20
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let seen = 0;
let order = "";
function note(text: string) { order = order + text; return text; }
function named(on: boolean) { const key = on ? "size" : "size"; return { first: 0, get [key]() { return 1; }, last: 2 }; }
function pair() { return { get ["a-b"]() { return 1; }, set ["a-b"](v: number) { seen = v; }, get c() { return 3; } }; }
function indexed(on: boolean) { const key = on ? "7" : "7"; return { z: 0, get [key]() { return 1; } }; }
function proto(on: boolean) { const key = on ? "__proto__" : "__proto__"; return { get [key]() { return 1; } }; }
function computed(key: string) { return { a: 0, get [key]() { return 1; }, b: 2 }; }
function ordered() { return { get [note("x")]() { return 1; }, get ["y"]() { return 2; }, get [note("z")]() { return 3; } }; } // @ts-expect-error
function over(on: boolean) { const key = on ? "a" : "a"; return { a: 5, get [key]() { return 1; } }; }
function keysOf(o: object) { let text = ""; for (const k in o) text += k + ","; return text; }
function describe(o: object, key: string) { const d = Object.getOwnPropertyDescriptor(o, key); return d === undefined ? "none" : String(typeof d.get) + String(typeof d.set) + String(d.enumerable) + String(d.configurable); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => keysOf(named(true)));
tell(() => (named(false) as any).size);
tell(() => describe(named(true), "size"));
tell(() => keysOf(pair()));
tell(() => describe(pair(), "a-b"));
tell(() => { const o = pair() as any; o["a-b"] = 9; return seen * 10 + o["a-b"] + o.c; });
tell(() => keysOf(indexed(true)));
tell(() => (indexed(true) as any)[7]);
tell(() => describe(indexed(true), "7"));
tell(() => Object.getPrototypeOf(proto(true)) === Object.prototype);
tell(() => (proto(true) as any).__proto__);
tell(() => describe(proto(true), "__proto__"));
tell(() => keysOf(computed("m")));
tell(() => keysOf(computed("1")));
tell(() => keysOf(computed("a")));
tell(() => keysOf(ordered()));
tell(() => order);
tell(() => (over(true) as any).a);
tell(() => describe(over(true), "a"));
report("end");
