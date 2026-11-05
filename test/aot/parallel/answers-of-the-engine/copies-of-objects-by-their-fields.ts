// Copies of objects whose layouts the checker knows. The source is plain, or got its keys in another order, lost one, got one more, a symbol, an index, a getter, other attributes, an integrity level or another prototype.
// What is done to the copy is done to the copy alone: deleted from, frozen, given an accessor, stored to with another type, its prototype changed. The order of the keys is that of the source.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
type State = { a: number; b: number };
type Wide = { a: number; b: number; c: number };
type Options = { a?: number; b?: number };
function show(o: object): string { if (o === null || typeof o !== "object") return String(o); const parts: string[] = []; for (const key of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, key)!; parts.push(String(key) + "=" + ("value" in d ? String(d.value) : "accessor") + (d.enumerable ? "" : "!e") + (d.writable === false ? "!w" : "") + (d.configurable ? "" : "!c")); } return "{" + parts.join(",") + "}" + (Object.getPrototypeOf(o) === Object.prototype ? "" : " other prototype") + (Object.isFrozen(o) ? " frozen" : ""); }
function same(state: State): State { return { ...state }; }
function widen(state: State, c: number): Wide { return { ...state, c }; }
function over(state: State, a: number): State { return { ...state, a }; } // @ts-expect-error
function under(state: State, a: number): State { return { a, ...state }; }
function rest(wide: Wide): { b: number; c: number } { const { a, ...others } = wide; return others; }
function restOfTwo(wide: Wide): { c: number } { const { a, b, ...others } = wide; return others; }
function both(first: State, second: State): State { return { ...first, ...second }; }
function settle(defaults: Options, options: Options): Options { return { ...defaults, ...options }; }
function each(make: () => State, what: string) { for (let turn = 0; turn < 3; turn++) { const source = make(); report(what + " same " + show(same(source)) + " widen " + show(widen(source, 3)) + " over " + show(over(source, 9)) + " under " + show(under(source, 9)) + " both " + show(both(source, make())) + " source " + show(source)); } }
each(() => ({ a: 1, b: 2 }), "plain");
each(() => { const o = {} as State; o.b = 2; o.a = 1; return o; }, "other order");
each(() => { const o: State = { a: 1, b: 2 }; delete (o as any).a; return o; }, "deleted");
each(() => { const o: State = { a: 1, b: 2 }; delete (o as any).a; o.a = 5; return o; }, "deleted and stored again");
each(() => { const o: State = { a: 1, b: 2 }; (o as any).z = 7; return o; }, "one more");
each(() => { const o: State = { a: 1, b: 2 }; (o as any)[Symbol.for("s")] = 7; return o; }, "a symbol");
each(() => { const o: State = { a: 1, b: 2 }; (o as any)[0] = 7; return o; }, "an index");
each(() => { const o: State = { a: 1, b: 2 }; Object.defineProperty(o, "a", { get() { report("getter runs"); return 4; }, enumerable: true, configurable: true }); return o; }, "a getter");
each(() => { const o: State = { a: 1, b: 2 }; Object.defineProperty(o, "a", { value: 4, enumerable: false, writable: true, configurable: true }); return o; }, "not enumerable");
each(() => { const o: State = { a: 1, b: 2 }; Object.defineProperty(o, "b", { value: 4, enumerable: true, writable: false, configurable: false }); return o; }, "read only");
each(() => Object.freeze({ a: 1, b: 2 }), "frozen");
each(() => Object.seal({ a: 1, b: 2 }), "sealed");
each(() => Object.setPrototypeOf({ a: 1, b: 2 }, { inherited: 1 }), "another prototype");
each(() => Object.setPrototypeOf({ a: 1, b: 2 }, null), "no prototype");
each(() => ({ a: 1, b: 2, c: 3 }) as State, "a wider object");
each(() => ({ a: "text", b: null }) as any, "other types");
each(() => ({ a: 1.5, b: -0 }), "fractions");
each(() => [1, 2] as any, "a list");
each(() => "ab" as any, "a text");
each(() => 5 as any, "a number");
each(() => null as any, "null");
each(() => undefined as any, "undefined");
each(() => new Proxy({ a: 1, b: 2 }, { ownKeys(t) { report("ownKeys runs"); return Reflect.ownKeys(t); } }), "a proxy");
class Pair { a = 1; b = 2; get c() { return 3; } }
each(() => new Pair(), "an instance");
for (let turn = 0; turn < 3; turn++) { const wide: Wide = { a: 1, b: 2, c: 3 }; report("rest " + show(rest(wide)) + " " + show(restOfTwo(wide)) + " " + show(wide)); const shuffled = {} as Wide; shuffled.c = 3; shuffled.a = 1; shuffled.b = 2; report("rest of other order " + show(rest(shuffled)) + " " + show(restOfTwo(shuffled))); report("settle " + show(settle({ a: 1, b: 2 }, { b: 5 })) + " " + show(settle({ a: 1 }, { b: 5 })) + " " + show(settle({ b: 1 }, { a: 5 })) + " " + show(settle({}, {})) + " " + show(settle({ a: 1, b: 2 }, { a: undefined }))); }
function changed(what: string, change: (copy: any) => void) { for (const copyOf of [same, (s: State) => widen(s, 3), (s: State) => over(s, 9)]) { const source: State = { a: 1, b: 2 }; const copy = copyOf(source); try { change(copy); } catch (error) { report(what + " throws " + (error as Error).constructor.name); } report(what + " copy " + show(copy) + " source " + show(source) + " " + (copy.a as any) + " " + source.a); } }
changed("deleted from", copy => { delete copy.a; });
changed("frozen", copy => { Object.freeze(copy); "use strict"; copy.a = 5; });
changed("given an accessor", copy => { Object.defineProperty(copy, "a", { get() { return 8; }, enumerable: true, configurable: true }); });
changed("stored to with another type", copy => { copy.a = "text"; copy.b = { deep: 1 }; });
changed("its prototype changed", copy => { Object.setPrototypeOf(copy, { a: 0, inherited: 1 }); delete copy.a; });
changed("one more property", copy => { copy.z = 1; });
changed("no more properties", copy => { Object.preventExtensions(copy); copy.z = 1; });
function ofLiteral(i: number) { const o = { a: i, b: 1, c: 2 }; const { a, ...others } = o; return a + others.b + others.c + Object.keys(others).join(); }
function ofLiteralStoredTo(i: number) { const o = { a: i, b: 1, c: 2 }; o.b = 7; const { a, ...others } = o; o.c = 9; return a + others.b + others.c + Object.keys(others).join() + o.c; }
function ofLiteralInOtherOrder(i: number): string { const o: Wide = { c: 2, a: i, b: 1 }; const copy: Wide = { ...o }; return Object.keys(copy).join() + copy.a; }
function ofLiteralWithGetter(i: number): string { const o = { a: i, get b() { return 5; } }; const copy = { ...o }; return show(copy); }
function ofLiteralDeletedFrom(i: number): string { const o: Options = { a: i, b: 1 }; delete o.a; const copy: Options = { ...o }; return show(copy); }
function ofLiteralThatLeaves(i: number): string { const o: State = { a: i, b: 1 }; (globalThis as any).kept = o; (globalThis as any).kept.a = 40; const copy: State = { ...o }; return show(copy); }
for (let i = 0; i < 3; i++) report([ofLiteral(i), ofLiteralStoredTo(i), ofLiteralInOtherOrder(i), ofLiteralWithGetter(i), ofLiteralDeletedFrom(i), ofLiteralThatLeaves(i)].join(" | "));
report("end");
