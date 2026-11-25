// answers: without-library
// # `Object.defineProperty(o, key, { .. })` as one operation: each attribute present and left out, a property that is there already and may not be changed, an accessor, a descriptor below null, get beside value, a getter that is no function, a key that is a number, attributes that are truthy and falsy values, a target that is no object, frozen, a list, a function
// # f1 = plain, f2 = open, f3 = accessor, f12 = tell
// # RUN(FORM): walk f1 f3 mechanisms=all-ParameterGuards
// # FORM-LABEL: code f1:Body
// # FORM: = DefineOwnProperty
// # FORM-LABEL: code f3:Body
// # FORM: = DefineOwnProperty
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 24 of 24 of 24
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards-Inlining $SHELL
// # ALSO1: 24 of 24 of 24
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function plain(o: object, v: number) { return Object.defineProperty(o, "x", { value: v, enumerable: false }); }
function open(o: object, v: number) { return Object.defineProperty(o, "x", { value: v, enumerable: true, writable: true, configurable: true }); }
function accessor(o: object, g: () => number) { return Object.defineProperty(o, "y", { get: g, configurable: true }); }
function setter(o: object) { return Object.defineProperty(o, "y", { set(v: number) { log += "s" + v; }, enumerable: true }); }
function empty(o: object) { return Object.defineProperty(o, "e", { }); }
function belowNull(o: object, v: number) { return Object.defineProperty(o, "n", { __proto__: null, value: v } as PropertyDescriptor); }
function mixed(o: object, g: () => number) { return Object.defineProperty(o, "m", { get: g, value: 1 } as PropertyDescriptor); }
function badGetter(o: object) { return Object.defineProperty(o, "b", { get: 1 } as any); }
function numberKey(o: object, v: number) { return Object.defineProperty(o, 3, { value: v, enumerable: true }); }
function truthy(o: object, v: number) { return Object.defineProperty(o, "t", { value: v, enumerable: 1, writable: "" } as any); }
function describe(o: object, key: string) { const d = Object.getOwnPropertyDescriptor(o, key); return d ? [typeof d.value, String(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join() : "none"; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const target: any = { first: 1 };
tell(() => plain(target, 5) === target);
tell(() => describe(target, "x"));
tell(() => plain(target, 6));
tell(() => describe(target, "x"));
const second: any = { };
tell(() => describe(open(second, 7), "x"));
tell(() => { second.x = 8; return second.x; });
tell(() => describe(plain(second, 9), "x"));
tell(() => describe(accessor(second, () => 11), "y"));
tell(() => second.y);
tell(() => describe(setter(second), "y"));
tell(() => { second.y = 4; return log; });
tell(() => describe(empty(second), "e"));
tell(() => describe(belowNull(second, 2), "n"));
tell(() => mixed(second, () => 1));
tell(() => badGetter(second));
tell(() => describe(numberKey(second, 1), "3"));
tell(() => describe(truthy(second, 1), "t"));
tell(() => Object.keys(second).join());
tell(() => plain(1 as any, 1));
tell(() => plain(null as any, 1));
tell(() => plain(Object.freeze({ }), 1));
tell(() => describe(plain([1, 2], 3), "x"));
tell(() => describe(plain(() => 1, 3), "x"));
report("end");
