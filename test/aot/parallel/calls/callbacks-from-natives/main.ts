// Built-in functions (`sort`, `forEach`, `replace`, Map and Set iteration ..) call compiled callbacks of every form.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
const out = (label: string, f: () => unknown, withMessage = true) => { let r: unknown; try { r = f(); } catch (e: any) { r = "threw " + e.constructor.name + (withMessage ? ": " + e.message : ""); } console.log(label, typeof r === "string" ? r : JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v !== v ? "NaN" : v)); };
class Point { constructor(public x: number, public name: string) {} }

// Parameters of each type, in typed code.
const byInteger = (a: number, b: number): number => (a | 0) - (b | 0);
const byDouble = (a: number, b: number): number => a - b;
const byBoolean = (a: boolean, b: boolean): number => (a ? 1 : 0) - (b ? 1 : 0);
const byString = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const byReference = (a: Point, b: Point): number => a.x - b.x || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const byOptional = (a: number | undefined, b: number | undefined): number => (a ?? -1) - (b ?? -1);
const byUnion = (a: number | string, b: number | string): number => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const yieldsBoolean = (a: number, b: number): any => a > b;
const yieldsString = (a: number, b: number): any => String(a - b);
const yieldsNothing = (_a: number, _b: number): any => undefined;
const yieldsObject = (a: number, b: number): any => ({ valueOf() { return a - b; } });
const integers = () => [5, 3, 9, 1, 7, 3, 0, -2, 2147483647, -2147483648, 8, 6];
const doubles = () => [1.5, -0, 0, 2.25, -1e300, 1e300, 0.1, 5e-324, 3, -3.5];
const points = () => [new Point(2, "b"), new Point(1, "z"), new Point(2, "a"), new Point(0, "q")];
out("sort integers", () => integers().sort(byInteger));
out("sort doubles", () => doubles().sort(byDouble));
out("sort booleans", () => [true, false, true, false, false].sort(byBoolean));
out("sort strings", () => ["pear", "apple", "", "fig", "Apple", "é"].sort(byString));
out("sort references", () => points().sort(byReference).map(p => p.x + p.name));
out("sort union", () => [10, "9", 1, "a", 2].sort(byUnion));
out("sort holes and undefined", () => { const a: (number | undefined)[] = [3, undefined, 1, , 2] as any; return a.sort(byOptional).length + ":" + String(a); });
out("toSorted", () => [integers().toSorted(byInteger), doubles().toSorted(byDouble), points().toSorted(byReference).map(p => p.name)]);
for (const [name, f] of [["boolean", yieldsBoolean], ["string", yieldsString], ["nothing", yieldsNothing], ["object", yieldsObject]] as [string, any][]) out("sort yields " + name, () => integers().sort(f));

// Every shape of callee.
for (const name of ["compare", "compareOne", "compareNone", "compareFour", "compareRest", "compareArguments", "compareThis", "compareAsync", "compareGenerator"]) { out("sort " + name, () => integers().sort(m[name])); out("typed array sort " + name, () => Array.from(new Int32Array(integers()).sort(m[name]))); }
out("counting", () => { const f = m.makeCounting(); const r = integers().sort(f); return [r, f.calls() > 10]; });
out("with a property", () => { const f: any = (a: number, b: number) => b - a; f.extra = 1; delete f.extra; f.other = 2; return integers().sort(f); });
out("with another prototype", () => { const f: any = (a: number, b: number) => b - a; Object.setPrototypeOf(f, null); return integers().sort(f); });
out("bound this", () => integers().sort(new m.Comparer(-1).compare.bind(new m.Comparer(-1))));
out("bound arguments", () => integers().sort(((sign: number, a: number, b: number) => sign * (a - b)).bind(null, -1)));
out("bound twice", () => integers().sort(((s: number, t: number, a: number, b: number) => s * t * (a - b)).bind(null, -1).bind(null, 2)));
out("static method", () => integers().sort(m.Comparer.compare));
out("method without this", () => integers().sort(new m.Comparer(1).compare), false);
out("class", () => integers().sort(m.Comparer));
out("typed class", () => integers().sort(Point as any));
out("proxy", () => integers().sort(new Proxy(byInteger, {})));
out("proxy with a trap", () => integers().sort(new Proxy(byInteger, { apply(target, self, list) { return -(target as any)(...list); } })));
for (const at of [1, 2, 7]) out("throws at " + at, () => integers().sort(m.makeThrowing(at)));
out("throws, then goes on", () => { const a = integers(); try { a.sort(m.makeThrowing(3)); } catch {} return a.sort(byInteger); });
out("comes in again", () => integers().sort((a, b) => [a, b].sort(byInteger)[0] === a ? -1 : 1));
out("changes the array", () => { const a = integers(); return [a.sort((x, y) => { a.length = 2; a.push(99); return x - y; }), a.length]; });
out("deep", () => { let depth = 0; const deep = (): number => { depth++; return [1, 2].sort(() => deep())[0]; }; try { deep(); } catch (e: any) { return e.constructor.name + (depth > 50); } return "none"; });
out("allocates", () => { let kept: Point[] = []; const a: number[] = []; for (let i = 0; i < 3000; i++) a.push((i * 7919) % 3001); a.sort((x, y) => { kept.push(new Point(x, "p" + y)); if (kept.length > 500) kept = []; return x - y; }); return [a[0], a[1500], a[2999]]; });

// The loops of typed arrays: value, index, array; thisArg.
const kinds: [string, any, any[]][] = [["Int8Array", Int8Array, [1, -2, 3, 0]], ["Uint8Array", Uint8Array, [1, 2, 250, 0]], ["Uint8ClampedArray", Uint8ClampedArray, [1, 2, 255, 0]], ["Int16Array", Int16Array, [-300, 2, 3, 0]], ["Uint32Array", Uint32Array, [4294967295, 2, 3, 0]],
  ["Float32Array", Float32Array, [1.5, -0, NaN, 3]], ["Float64Array", Float64Array, [1.5, -0, NaN, 1e300]], ["BigInt64Array", BigInt64Array, [1n, -2n, 3n, 0n]]];
for (const [name, Kind, list] of kinds) {
  const isBig = name.startsWith("Big");
  const positive = isBig ? (v: bigint, _i: number): boolean => v > 0n : (v: number, _i: number): boolean => v > 0;
  const double = isBig ? (v: bigint): bigint => v * 2n : (v: number): number => v * 2;
  const add = isBig ? (s: bigint, v: bigint, i: number): bigint => s + v + BigInt(i) : (s: number, v: number, i: number): number => s + v + i;
  const a = new Kind(list);
  out(name, () => [a.every(positive), a.some(positive), Array.from(a.filter(positive)), a.find(positive), a.findIndex(positive), a.findLast(positive), a.findLastIndex(positive), Array.from(a.map(double)), a.reduce(add), a.reduceRight(add),
    a.reduce(add, isBig ? 10n : 10), Array.from(a.toSorted(isBig ? (x: bigint, y: bigint) => x < y ? 1 : x > y ? -1 : 0 : (x: number, y: number) => y - x))]);
  out(name + " forEach", () => { const self = { log: [] as string[] }; a.forEach(m.visit, self); a.map(m.visit, self); return self.log; });
  out(name + " typed this", () => { const seen: string[] = []; a.forEach(function (this: Point, v: unknown, i: number, all: unknown) { seen.push(this.name + String(v) + i + (all === a)); }, new Point(1, "self")); return seen; });
  out(name + " throws", () => a.map((v: unknown, i: number) => { if (i === 2) throw new TypeError("at " + i + " " + String(v)); return v; }));
}

// Strings and regular expressions.
const text = "The quick brown fox, the lazy dog; 12 and 345.";
out("replace global", () => text.replace(/[aeiou]/g, (c: string): string => c.toUpperCase()));
out("replace offsets", () => text.replace(/\d+/g, (d: string, at: number, whole: string): string => "<" + d + "@" + at + ":" + whole.length + ">"));
out("replace groups", () => text.replace(/(\w)(\w*)/g, (_all: string, first: string, rest: string): string => rest + first));
out("replace optional group", () => "ab a b".replace(/(a)(b)?/g, (all: string, a: string, b: string | undefined, at: number): string => "[" + all + a + String(b) + at + "]"));
out("replace named", () => "2026-10-08".replace(/(?<y>\d+)-(?<m>\d+)-(?<d>\d+)/, (...r: any[]): string => r[r.length - 1].d + "." + r[r.length - 1].m + "." + r[r.length - 1].y + ":" + r.length));
out("replace named global", () => "a1 b2".replace(/(?<l>[a-z])(?<n>\d)/g, (_a: string, _l: string, _n: string, at: number, _w: string, groups: { l: string; n: string }): string => groups.n + groups.l + at));
out("replace once", () => text.replace(/quick/, (q: string): string => q.length + ""));
out("replace string pattern", () => text.replace("fox", (f: string, at: number, whole: string): string => f + at + whole.length));
out("replaceAll string pattern", () => "a.b.c".replaceAll(".", (_d: string, at: number): string => String(at)));
out("replaceAll regexp", () => "a.b.c".replaceAll(/\./g, (_d: string, at: number): string => "<" + at + ">"));
out("replace yields other things", () => "abcd".replace(/./g, ((c: string, at: number) => [1, undefined, null, { toString() { return c + "!"; } }][at]) as any));
out("replace untyped", () => [text.replace(/o/g, m.count0), text.replace(/(o)(.)/g, m.count3), text.replace(/(T)(h)(e)( )(q)(u)/, m.count9), text.replace(/(f)(o)(x)/g, m.countRest)]);
out("replace long", () => { let s = ""; for (let i = 0; i < 400; i++) s += "ab" + (i % 10); let n = 0; const r = s.replace(/b\d/g, (b: string, at: number): string => { n += at; return b[1]; }); const again = s.replace(/b\d/g, (b: string): string => b[1] + "."); return [r.length, n, again.length]; });
out("replace throws", () => text.replace(/o/g, (_o: string, at: number): string => { if (at > 20) throw new RangeError("at " + at); return "0"; }));
out("replace comes in again", () => text.replace(/\w+/g, (w: string): string => w.replace(/[a-z]/g, (c: string): string => c === "o" ? "0" : c)));
out("own exec", () => { const re: any = /x/g; let n = 0; re.exec = function (this: RegExp, s: string) { return n++ < 2 ? Object.assign(["q"], { index: n, input: s }) : null; }; return ["aqbqc".replace(re, "-"), re.test("z"), n]; });
out("split and match with own exec", () => { const re: any = /b/; re.exec = (s: string) => s.length > 3 ? Object.assign(["b"], { index: 1, input: s }) : null; return [re.test("abcd"), re.test("ab"), "abcd".search(re)]; });

// Collections and iteration.
out("getOrInsertComputed", () => { const map: any = new Map<string, number>([["a", 1]]); const weak: any = new WeakMap<object, string>(); const key = {}; if (!map.getOrInsertComputed) return "none";
  return [map.getOrInsertComputed("a", (k: string): number => k.length + 10), map.getOrInsertComputed("bcd", (k: string): number => k.length + 10), map.get("bcd"), weak.getOrInsertComputed(key, (k: object): string => typeof k), weak.getOrInsertComputed(key, m.count0)]; });
const counter = (limit: number, log: string[]) => ({ [Symbol.iterator]() { let i = 0; return { next(): { done: boolean; value: number } { log.push("n" + i); return { done: i >= limit, value: i++ }; }, return(): { done: boolean; value: number } { log.push("r"); return { done: true, value: -1 }; } }; } });
out("constructors take an iterable", () => { const log: string[] = []; return [[...new Set(counter(3, log))], [...new Map([...counter(2, log)].map(i => [i, i * 2] as [number, number]))], Array.from(counter(3, log), (v: number, i: number): string => v + ":" + i), log.join("")]; });
out("iterator helpers", () => { const log: string[] = []; const it = () => (Iterator as any).from(counter(5, log)[Symbol.iterator]()); const seen: string[] = []; it().forEach((v: number, i: number): void => { seen.push(v + "@" + i); });
  return [seen, it().toArray(), it().some((v: number): boolean => v === 2), it().every((v: number): boolean => v < 3), it().find((v: number): boolean => v > 2), it().reduce((s: number, v: number): number => s + v), it().reduce((s: string, v: number): string => s + v, "r"),
    it().map((v: number): number => v * 2).filter((v: number): boolean => v % 4 === 0).take(2).toArray(), it().flatMap((v: number): number[] => [v, v]).drop(7).toArray(), log.length]; });
out("iterator helper throws", () => { const log: string[] = []; try { (Iterator as any).from(counter(5, log)[Symbol.iterator]()).forEach((v: number): void => { if (v === 1) throw new Error("stop"); }); } catch (e: any) { log.push(e.message); } return log.join(""); });
const setLike = (list: number[], log: string[]) => ({ size: list.length, has(v: number): boolean { log.push("h" + v); return list.includes(v); }, keys() { let i = 0; return { next(): { done: boolean; value: number | undefined } { log.push("k" + i); return i < list.length ? { done: false, value: list[i++] } : { done: true, value: undefined }; } }; } });
out("set methods", () => { const log: string[] = []; const s: any = new Set([1, 2, 3, 4]); const r: unknown[] = []; for (const name of ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]) for (const list of [[2, 3], [1, 2, 3, 4, 5, 6], [9]]) { const v = s[name](setLike(list, log)); r.push(typeof v === "boolean" ? v : [...v].join("")); } return [r, log.join("").length]; });
out("groupBy", () => [Object.entries((Object as any).groupBy([1, 2, 3, 4, 5], (v: number, i: number): string => (v + i) % 3 === 0 ? "a" : "b")), [...(Map as any).groupBy(["x", "yy", "z"], (s: string): number => s.length)]]);
out("map and set forEach", () => { const seen: string[] = []; new Map([["a", 1], ["b", 2]]).forEach(function (this: Point, v: number, k: string, all: Map<string, number>) { seen.push(this.name + k + v + all.size); }, new Point(0, "t")); new Set([true, false]).forEach((v: boolean, again: boolean): void => { seen.push(String(v === again)); }); return seen; });

// Once, from C++: 0 to 9 arguments through a proxy and a bound function; conversions; JSON; accessors.
for (const name of ["count0", "count3", "count9", "countRest"]) out("proxy " + name, () => { const p = new Proxy(m[name], {}); return [p(), p(1), p(1, 2), p(1, 2, 3), p(1, 2, 3, 4), p(1, 2, 3, 4, 5), p(1, 2, 3, 4, 5, 6), p(1, 2, 3, 4, 5, 6, 7), p(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)]; });
const typedOf = { none: (): string => "n", integer: (a: number): string => "i" + (a | 0), double: (a: number, b: number): string => "d" + (a + b), boolean: (a: boolean, b: boolean, c: boolean): string => "b" + (a && b || c), text: (a: string, b: string, c: string, d: string): string => a + b + c + d,
  reference: (a: Point, b: Point, c: Point, d: Point, e: Point): string => a.name + b.name + c.name + d.name + e.name, mixed: (a: number, b: string, c: boolean, d: Point, e: number, f: undefined, g: null, h: number): string => [a, b, c, d.name, e, f, g, h].join() };
const p1 = new Point(1, "p");
out("proxy typed", () => [new Proxy(typedOf.none, {})(), new Proxy(typedOf.integer, {})(7), new Proxy(typedOf.double, {})(1.5, 2.25), new Proxy(typedOf.boolean, {})(true, false, true), new Proxy(typedOf.text, {})("a", "b", "c", "d"), new Proxy(typedOf.reference, {})(p1, p1, p1, p1, p1), new Proxy(typedOf.mixed, {})(1, "s", true, p1, 2.5, undefined, null, -0)]);
out("conversions", () => { const o = { valueOf(): number { return 42; }, toString(): string { return "text"; } }; const q = { [Symbol.toPrimitive](hint: string): string | number { return hint === "number" ? 7 : hint; } }; return [`${o}`, +(o as any), (o as any) + 1, [o, o].join("-"), `${q as any}`, +(q as any), (q as any) + "", new Date(q as any).getTime(), Math.max(o as any, q as any), "x".repeat(q as any).length, isNaN(o as any)]; });
out("JSON", () => [JSON.parse('{"a":[1,2,{"b":true}],"c":"s","d":null}', function (this: any, k: string, v: unknown): unknown { return typeof v === "number" ? v * 2 : k === "c" ? undefined : Array.isArray(v) ? v.length : v; }),
  JSON.stringify({ a: [1, 2.5, { b: true }], c: "s", d: new Point(3, "n"), e: { toJSON(key: string): string { return "json:" + key; } } }, (k: string, v: unknown): unknown => typeof v === "number" ? v + 1 : k === "name" ? undefined : v), JSON.stringify([new Date(0).toISOString()], m.count3 as any)]);
class Accessors { private v = 1; get value(): number { return this.v; } set value(n: number) { this.v = n * 2; } get [Symbol.toStringTag](): string { return "Acc" + this.v; } }
out("accessors", () => { const a = new Accessors(); const d = Object.getOwnPropertyDescriptor(Accessors.prototype, "value")!; const bag = Object.defineProperty({} as any, "g", { get: (): string => "got", set(this: any, v: string) { this.kept = v; }, enumerable: true });
  return [Reflect.get(a, "value"), Reflect.set(a, "value", 4), d.get!.call(a), Object.prototype.toString.call(a), Object.assign({}, bag), Object.assign(bag, { g: "put" }).kept, JSON.stringify(bag), Object.entries(bag), structuredCloneLike(bag)]; });
function structuredCloneLike(o: object): object { return Object.fromEntries(Object.entries(o)); }
out("array natives", () => [Array.from({ length: 3 }, (_v: unknown, i: number): number => i * i), Array.from("abc", (c: string): string => c + c), Array.prototype.map.call("xy", (c: string, i: number): string => c + i), [[1, 2], [3]].flatMap((l: number[]): number[] => l), [3, 1, 2].findLast((v: number): boolean => v < 3), Reflect.apply(typedOf.double, null, [1, 2]), Function.prototype.call.call(typedOf.integer, null, 9), Function.prototype.apply.call(typedOf.text, null, ["w", "x", "y", "z"])]);

// Promises: `resolve` of a subclass, thenables, reactions. Printed last, in order.
class Tracked<T> extends Promise<T> { static log: string[] = []; static resolve(v?: any): any { Tracked.log.push("r" + String(v)); return super.resolve(v); } }
const thenable = (v: number) => ({ then(ok: (v: number) => void): void { ok(v * 10); } });
(async () => {
  console.log("all", JSON.stringify(await Tracked.all([1, thenable(2), Promise.resolve(3)])), JSON.stringify(await Tracked.allSettled([1, Promise.reject(new Error("no"))]).then((l: any[]) => l.map(x => x.status))), await Tracked.race([4, 5]), await Tracked.any([Promise.reject(1), 6]), Tracked.log.join());
  console.log("then", await Promise.resolve(1).then((v: number): number => v + 1).then((v: number): string => "s" + v).finally((): void => {}), await Promise.reject(new RangeError("x")).catch((e: Error): string => e.message), await new Promise<number>((ok: (v: number) => void): void => void Promise.resolve().then((): void => ok(5))));
})();
export {};
