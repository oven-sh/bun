// A class may extend whatever its `extends` clause evaluates to. Here that is a class of the engine, and nothing in the program says so in words: a mixin whose parameter is `any` or wider than
// the built-in, a constant typed `any`, a cast. Typed code that takes the built-in's type finds what the heir overrides.
type Constructor = new (...given: any[]) => object;
const loud = (Base: any) => class extends Base { loud = true; };
const wide = <T extends Constructor>(Base: T) => class extends Base { wide = 1; };
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name, (error as Error).message); }
};
function readsMap(map: Map<string, number>): string { return [map.get("a"), map.has("a"), map.size, [...map.keys()].join()].join(" "); }
function readsSet(set: Set<string>): string { return [set.has("a"), set.size, [...set].join()].join(" "); }
function readsDate(date: Date): string { return [date.getTime(), date.getFullYear() > 1900, date.toISOString()].join(" "); }
function readsRegExp(pattern: RegExp): string { return [pattern.test("abc"), "abc".replace(pattern, "_"), pattern.source].join(" "); }
function readsBytes(bytes: Uint8Array): string { return [bytes.length, bytes.indexOf(2), bytes.at(0), bytes[1]].join(" "); }
function readsView(view: DataView): string { return [view.byteLength, view.getInt8(0)].join(" "); }
function readsBuffer(buffer: ArrayBuffer): string { return [buffer.byteLength, buffer.slice(1).byteLength].join(" "); }
for (let i = 0; i < 300; i++) {
  readsMap(new Map([["a", 1]])); readsSet(new Set(["a"])); readsDate(new Date(0)); readsRegExp(/b/); readsBytes(new Uint8Array([1, 2, 3])); readsView(new DataView(new ArrayBuffer(4))); readsBuffer(new ArrayBuffer(8));
}
const bases: [string, any, unknown[]][] = [
  ["Map", Map, [[["a", 1]]]], ["Set", Set, [["a"]]], ["WeakMap", WeakMap, [[[globalThis, 1]]]], ["WeakSet", WeakSet, [[globalThis]]], ["Date", Date, [0]], ["RegExp", RegExp, ["b"]],
  ["ArrayBuffer", ArrayBuffer, [8]], ["DataView", DataView, [new ArrayBuffer(4)]], ["Uint8Array", Uint8Array, [[1, 2, 3]]], ["Int16Array", Int16Array, [[1, 2, 3]]], ["Float64Array", Float64Array, [[1, 2, 3]]], ["BigInt64Array", BigInt64Array, [2]],
  ["Array", Array, [1, 2, 3]], ["Error", Error, ["m"]], ["Promise", Promise, [() => {}]], ["Object", Object, []], ["Function", Function, ["return 1"]], ["String", String, ["s"]], ["Number", Number, [5]], ["Boolean", Boolean, [true]],
];
for (const [name, Base, given] of bases) {
  show(name + " mixin", () => { const made: any = new (loud(Base) as any)(...given); return [made instanceof Base, made.loud, Object.getPrototypeOf(Object.getPrototypeOf(made)) === Base.prototype, Object.prototype.toString.call(made)].join(" "); });
  show(name + " wide mixin", () => { const made: any = new (wide(Base) as any)(...given); return [made instanceof Base, made.wide, Object.keys(made).includes("wide")].join(" "); });
}
const AnyMap: any = Map;
class Counted extends AnyMap { reads = 0; get(key: string): number { this.reads++; return 4242; } has(): boolean { return false; } get size(): number { return 77; } }
class Sorted extends (Set as any) { has(): boolean { return false; } *[Symbol.iterator](): Generator<string> { yield "heir"; } }
const AnyDate: any = Date;
class Frozen extends AnyDate { getTime(): number { return 4242; } toISOString(): string { return "heir"; } }
class Never extends (RegExp as any) { test(): boolean { return false; } exec(): null { return null; } }
const AnyBytes: any = Uint8Array;
class Bytes extends AnyBytes { indexOf(): number { return 4242; } at(): number { return 4243; } }
class View extends (DataView as any) { getInt8(): number { return 42; } }
class Buffer8 extends (ArrayBuffer as any) { slice(): ArrayBuffer { return new ArrayBuffer(1); } }
show("Map heir", () => { const made: any = new (Counted as any)([["a", 1]]); return readsMap(made) + " " + made.reads + " " + Map.prototype.get.call(made, "a"); });
show("Set heir", () => readsSet(new (Sorted as any)(["a"])));
show("Date heir", () => readsDate(new (Frozen as any)(0)));
show("RegExp heir", () => readsRegExp(new (Never as any)("b")));
show("Uint8Array heir", () => readsBytes(new (Bytes as any)([1, 2, 3])));
show("DataView heir", () => readsView(new (View as any)(new ArrayBuffer(4))));
show("ArrayBuffer heir", () => readsBuffer(new (Buffer8 as any)(8)));
show("plain ones after the heirs", () => [readsMap(new Map([["a", 1]])), readsSet(new Set(["a"])), readsDate(new Date(0)), readsRegExp(/b/), readsBytes(new Uint8Array([1, 2, 3])), readsView(new DataView(new ArrayBuffer(4))), readsBuffer(new ArrayBuffer(8))].join(" | "));
show("through a bound function", () => new (loud(Map.bind(null)) as any)([["a", 1]]).get("a"));
show("through a proxy", () => new (loud(new Proxy(Set, {})) as any)(["a"]).has("a"));
show("an heir of an heir", () => { const made: any = new (loud(loud(Date)) as any)(0); return [made instanceof Date, made.getTime(), made.loud].join(" "); });
show("no constructor", () => new (loud({}) as any)());
show("null", () => Object.getPrototypeOf(loud(null).prototype));
