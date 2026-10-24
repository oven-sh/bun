// Descriptors that are made on several ways and meet in front of the call that takes them.
const lines: string[] = [];
function show(name: string, ...values: unknown[]) { lines.push(name + ": " + values.map(value => typeof value === "function" ? "function " + value.name : typeof value === "symbol" ? value.toString() : JSON.stringify(value) ?? String(value)).join(" | ")); }
function attempt(run: () => unknown): unknown { try { return run(); } catch (error) { return "threw " + (error as Error).name; } }
const order: string[] = [];
function note<T>(text: string, value: T): T { order.push(text); return value; }

function getters(target: object, key: PropertyKey, first: boolean, a: any, b: any) {
    return Object.defineProperty(target, key, first ? { get: a, enumerable: true, configurable: true } : { get: b, enumerable: true, configurable: true });
}
function values(target: object, key: PropertyKey, first: boolean, a: unknown, b: unknown) {
    return Object.defineProperty(target, key, first ? { value: a, writable: false } : { value: b, writable: false });
}
function otherAttributes(target: object, key: PropertyKey, first: boolean, a: unknown) {
    return Object.defineProperty(target, key, first ? { value: a, enumerable: true } : { value: a, enumerable: false });
}
function inOrder(target: object, first: boolean) {
    return Object.defineProperty(note("target", target), note("key", "k"), first ? { get: note("first", () => 1), enumerable: note("flag", true) } : { get: note("second", () => 2), enumerable: note("flag", true) });
}
const o: any = {};
getters(o, "a", true, () => "from a", () => "from b"); getters(o, "b", false, () => "from a", () => "from b");
show("getters", o.a, o.b, Object.keys(o), Object.getOwnPropertyDescriptor(o, "a")!.configurable);
show("not callable", attempt(() => getters(o, "c", true, 5, () => 1)), attempt(() => getters(o, "c", false, () => 1, "text")), "c" in o, attempt(() => getters(o, "d", true, undefined, null)), Object.getOwnPropertyDescriptor(o, "d"));
values(o, "v", true, 1, "two"); values(o, "w", false, 1, "two");
show("values", o.v, o.w, attempt(() => { "use strict"; o.v = 3; return "stored"; }), Object.keys(o));
otherAttributes(o, "e", true, 1); otherAttributes(o, "f", false, 2);
show("attributes", Object.keys(o), o.e, o.f);
show("result", getters({}, "x", true, () => 1, () => 2) instanceof Object, attempt(() => getters(5 as never, "x", true, () => 1, () => 2)), attempt(() => getters(Object.freeze({}), "x", false, () => 1, () => 2)));
const mark = Symbol("mark");
getters(o, mark, false, () => 1, () => "by symbol"); getters(o, 7, true, () => "by index", () => 2);
show("keys", o[mark], o[7], Reflect.ownKeys(o).length);
inOrder({}, true); inOrder({}, false);
show("order", order);
getters(o, "a", false, () => 0, () => "again");
show("again", o.a, attempt(() => values(o, "v", true, 9, 9)), o.v);

function fill(names: [string, number][]) {
    const made: Record<string, unknown> = Object.create(null);
    for (const [name, n] of names) Object.defineProperty(made, name, { get: n & 1 ? () => "odd " + n : () => "even " + n, enumerable: true, configurable: true });
    return made;
}
const filled = fill([["p", 1], ["q", 2], ["r", 3]]);
show("in a loop", filled.p, filled.q, filled.r, Object.keys(filled));
console.log(lines.join("\n"));
