// `instanceof` against built-in classes, on typed, untyped and odd values, alone and in loops. The constructors and prototypes of these classes are locked: Symbol.hasInstance cannot be defined on them and their prototype links cannot be changed, so after the attempts every test answers as before them.
type Thing = Map<string, number> | Set<string> | WeakMap<object, number> | WeakSet<object> | Date | RegExp | Promise<number> | number[];
const lines: string[] = [];
function thingIsMap(v: Thing): boolean { return v instanceof Map; }
function thingOrNilIsMap(v: Thing | undefined | null): boolean { return v instanceof Map; }
function anyIsMap(v: any): boolean { return v instanceof Map; }
function unknownIsMap(v: unknown): number { if (v instanceof Map) return 1; return 0; }
function inLoopMap(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof Map) n++; } return n; }
function thingIsSet(v: Thing): boolean { return v instanceof Set; }
function thingOrNilIsSet(v: Thing | undefined | null): boolean { return v instanceof Set; }
function anyIsSet(v: any): boolean { return v instanceof Set; }
function unknownIsSet(v: unknown): number { if (v instanceof Set) return 1; return 0; }
function inLoopSet(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof Set) n++; } return n; }
function thingIsWeakMap(v: Thing): boolean { return v instanceof WeakMap; }
function thingOrNilIsWeakMap(v: Thing | undefined | null): boolean { return v instanceof WeakMap; }
function anyIsWeakMap(v: any): boolean { return v instanceof WeakMap; }
function unknownIsWeakMap(v: unknown): number { if (v instanceof WeakMap) return 1; return 0; }
function inLoopWeakMap(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof WeakMap) n++; } return n; }
function thingIsWeakSet(v: Thing): boolean { return v instanceof WeakSet; }
function thingOrNilIsWeakSet(v: Thing | undefined | null): boolean { return v instanceof WeakSet; }
function anyIsWeakSet(v: any): boolean { return v instanceof WeakSet; }
function unknownIsWeakSet(v: unknown): number { if (v instanceof WeakSet) return 1; return 0; }
function inLoopWeakSet(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof WeakSet) n++; } return n; }
function thingIsDate(v: Thing): boolean { return v instanceof Date; }
function thingOrNilIsDate(v: Thing | undefined | null): boolean { return v instanceof Date; }
function anyIsDate(v: any): boolean { return v instanceof Date; }
function unknownIsDate(v: unknown): number { if (v instanceof Date) return 1; return 0; }
function inLoopDate(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof Date) n++; } return n; }
function thingIsRegExp(v: Thing): boolean { return v instanceof RegExp; }
function thingOrNilIsRegExp(v: Thing | undefined | null): boolean { return v instanceof RegExp; }
function anyIsRegExp(v: any): boolean { return v instanceof RegExp; }
function unknownIsRegExp(v: unknown): number { if (v instanceof RegExp) return 1; return 0; }
function inLoopRegExp(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof RegExp) n++; } return n; }
function thingIsPromise(v: Thing): boolean { return v instanceof Promise; }
function thingOrNilIsPromise(v: Thing | undefined | null): boolean { return v instanceof Promise; }
function anyIsPromise(v: any): boolean { return v instanceof Promise; }
function unknownIsPromise(v: unknown): number { if (v instanceof Promise) return 1; return 0; }
function inLoopPromise(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof Promise) n++; } return n; }
function thingIsArray(v: Thing): boolean { return v instanceof Array; }
function thingOrNilIsArray(v: Thing | undefined | null): boolean { return v instanceof Array; }
function anyIsArray(v: any): boolean { return v instanceof Array; }
function unknownIsArray(v: unknown): number { if (v instanceof Array) return 1; return 0; }
function inLoopArray(all: Thing[]): number { let n = 0; for (let i = 0; i < all.length; i++) { const v = all[i]; if (v instanceof Array) n++; } return n; }
class MapHeir extends Map<string, number> { }
class SetHeir extends Set<string> { }
class DateHeir extends Date { }
class ArrayHeir extends Array<number> { }
class PromiseHeir extends Promise<number> { }
function withPrototype<T extends object>(o: T, p: object | null): T { Object.setPrototypeOf(o, p); return o; }
const things: Array<[string, Thing]> = [
    ["a Map", new Map()], ["a Set", new Set()], ["a WeakMap", new WeakMap()], ["a WeakSet", new WeakSet()], ["a Date", new Date(0)], ["a RegExp", /x/], ["a Promise", Promise.resolve(1)], ["an array", [1]], ["an empty array", []],
    ["an heir of Map", new MapHeir()], ["an heir of Set", new SetHeir()], ["an heir of Date", new DateHeir(0)], ["an heir of Array", new ArrayHeir()], ["an heir of Promise", PromiseHeir.resolve(1) as Promise<number>],
    ["a Map without prototype", withPrototype(new Map(), null)], ["a Map that inherits from Set.prototype", withPrototype(new Map(), Set.prototype)], ["a Set that inherits from Map.prototype", withPrototype(new Set<string>(), Map.prototype)],
    ["an array that inherits from Map.prototype", withPrototype([1], Map.prototype)], ["a Date that inherits from Array.prototype", withPrototype(new Date(0), Array.prototype)], ["a RegExp that inherits from a Map", withPrototype(/x/, new Map())],
    ["a Map with a property", Object.assign(new Map(), { extra: 1 })], ["an array with a property", Object.assign([1], { extra: 1 })], ["a frozen Map", Object.freeze(new Map())], ["a frozen array", Object.freeze([1]) as number[]],
];
const others: Array<[string, unknown]> = [
    ["undefined", undefined], ["null", null], ["a number", 5], ["a text", "Map"], ["true", true], ["a symbol", Symbol.iterator], ["a bigint", 5n], ["an object", {}], ["a function", function () { }], ["Map itself", Map], ["Map.prototype", Map.prototype], ["Array.prototype", Array.prototype],
    ["what inherits from Map.prototype", Object.create(Map.prototype)], ["what inherits from Array.prototype", Object.create(Array.prototype)], ["what inherits from a Date", Object.create(new Date(0))], ["without prototype", Object.create(null)],
    ["a proxy of a Map", new Proxy(new Map(), {})], ["a proxy of an array", new Proxy([], {})], ["a proxy that says Set.prototype", new Proxy({}, { getPrototypeOf() { return Set.prototype; } })], ["an Error", new Error("x")], ["a typed array", new Uint8Array(1)],
];
function table(title: string): void {
    lines.push("== " + title);
    for (const [name, v] of things) lines.push(name + ": " + (thingIsMap(v) ? "1" : "0") + (thingIsSet(v) ? "1" : "0") + (thingIsWeakMap(v) ? "1" : "0") + (thingIsWeakSet(v) ? "1" : "0") + (thingIsDate(v) ? "1" : "0") + (thingIsRegExp(v) ? "1" : "0") + (thingIsPromise(v) ? "1" : "0") + (thingIsArray(v) ? "1" : "0") + " " + (thingOrNilIsMap(v) ? "1" : "0") + (thingOrNilIsSet(v) ? "1" : "0") + (thingOrNilIsWeakMap(v) ? "1" : "0") + (thingOrNilIsWeakSet(v) ? "1" : "0") + (thingOrNilIsDate(v) ? "1" : "0") + (thingOrNilIsRegExp(v) ? "1" : "0") + (thingOrNilIsPromise(v) ? "1" : "0") + (thingOrNilIsArray(v) ? "1" : "0") + " " + (anyIsMap(v) ? "1" : "0") + (anyIsSet(v) ? "1" : "0") + (anyIsWeakMap(v) ? "1" : "0") + (anyIsWeakSet(v) ? "1" : "0") + (anyIsDate(v) ? "1" : "0") + (anyIsRegExp(v) ? "1" : "0") + (anyIsPromise(v) ? "1" : "0") + (anyIsArray(v) ? "1" : "0") + " " + (unknownIsMap(v) ? "1" : "0") + (unknownIsSet(v) ? "1" : "0") + (unknownIsWeakMap(v) ? "1" : "0") + (unknownIsWeakSet(v) ? "1" : "0") + (unknownIsDate(v) ? "1" : "0") + (unknownIsRegExp(v) ? "1" : "0") + (unknownIsPromise(v) ? "1" : "0") + (unknownIsArray(v) ? "1" : "0"));
    for (const [name, v] of others) lines.push(name + ": " + (anyIsMap(v) ? "1" : "0") + (anyIsSet(v) ? "1" : "0") + (anyIsWeakMap(v) ? "1" : "0") + (anyIsWeakSet(v) ? "1" : "0") + (anyIsDate(v) ? "1" : "0") + (anyIsRegExp(v) ? "1" : "0") + (anyIsPromise(v) ? "1" : "0") + (anyIsArray(v) ? "1" : "0") + " " + (unknownIsMap(v) ? "1" : "0") + (unknownIsSet(v) ? "1" : "0") + (unknownIsWeakMap(v) ? "1" : "0") + (unknownIsWeakSet(v) ? "1" : "0") + (unknownIsDate(v) ? "1" : "0") + (unknownIsRegExp(v) ? "1" : "0") + (unknownIsPromise(v) ? "1" : "0") + (unknownIsArray(v) ? "1" : "0"));
    lines.push("nil: " + (thingOrNilIsMap(undefined) ? "1" : "0") + (thingOrNilIsSet(undefined) ? "1" : "0") + (thingOrNilIsWeakMap(undefined) ? "1" : "0") + (thingOrNilIsWeakSet(undefined) ? "1" : "0") + (thingOrNilIsDate(undefined) ? "1" : "0") + (thingOrNilIsRegExp(undefined) ? "1" : "0") + (thingOrNilIsPromise(undefined) ? "1" : "0") + (thingOrNilIsArray(undefined) ? "1" : "0") + " " + (thingOrNilIsMap(null) ? "1" : "0") + (thingOrNilIsSet(null) ? "1" : "0") + (thingOrNilIsWeakMap(null) ? "1" : "0") + (thingOrNilIsWeakSet(null) ? "1" : "0") + (thingOrNilIsDate(null) ? "1" : "0") + (thingOrNilIsRegExp(null) ? "1" : "0") + (thingOrNilIsPromise(null) ? "1" : "0") + (thingOrNilIsArray(null) ? "1" : "0"));
    const all = things.map(pair => pair[1]);
    lines.push("in loops: " + [inLoopMap(all), inLoopSet(all), inLoopWeakMap(all), inLoopWeakSet(all), inLoopDate(all), inLoopRegExp(all), inLoopPromise(all), inLoopArray(all)].join(" "));
}
table("as the realm was made");
(Map as any).extra = 1;
table("Map was given a harmless property");
const define: (o: object, key: symbol, d: object) => unknown = (Object as any)["define" + "Property"];
function attempt(what: string, run: () => unknown): void { try { lines.push(what + ": " + String(run()).slice(0, 12)); } catch (e) { lines.push(what + ": throws " + (e as Error).constructor.name); } }
attempt("define Set[Symbol.hasInstance]", () => define(Set, Symbol.hasInstance, { value: (v: unknown) => typeof v === "number", configurable: true }));
attempt("Reflect.defineProperty Map[Symbol.hasInstance]", () => (Reflect as any)["define" + "Property"](Map, Symbol.hasInstance, { value: () => true, configurable: true }));
attempt("assign Array[Symbol.hasInstance]", () => { (Array as any)[Symbol.hasInstance] = () => false; return 1; });
attempt("Object.setPrototypeOf(Map, ..)", () => (Object as any)["set" + "PrototypeOf"](Map, { [Symbol.hasInstance]: () => true }));
attempt("Object.setPrototypeOf(Set.prototype, Map.prototype)", () => (Object as any)["set" + "PrototypeOf"](Set.prototype, Map.prototype));
table("after the attempts");
console.log(lines.join("\n"));
