// Sound TypeScript is never refused: every value is made by typed code and satisfies its type, so each line is what plain Bun prints.
declare const console: { log(...values: unknown[]): void };
const all: [string, () => unknown][] = [];
const add = (name: string, f: () => unknown): void => { all.push([name, f]); };
const show = (v: unknown): string => typeof v === "bigint" ? v + "n" : typeof v === "function" ? "function" : typeof v === "symbol" ? String(v) : v instanceof Map ? "Map" + JSON.stringify([...v]) : v instanceof Set ? "Set" + JSON.stringify([...v]) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

// structural typing
class Point { constructor(public x: number, public y: number) {} }
interface HasX { x: number }
function sum(p: Point): number { return p.x + p.y; }
function getX(p: HasX): number { return p.x; }
add("a literal where a class is declared", () => sum({ x: 1, y: 2 }));
add("a class where an interface is declared", () => getX(new Point(3, 4)));
add("a literal with more members through a variable", () => { const q = { x: 5, y: 6, z: 7 }; return sum(q) + getX(q); });
class Point3 extends Point { constructor(x: number, y: number, public z: number) { super(x, y); } }
add("a subclass where the base is declared", () => sum(new Point3(1, 2, 3)));
class Other { constructor(public x: number, public y: number, public label: string) {} }
add("another class of the same shape", () => sum(new Other(8, 9, "o")));
add("an array of mixed makers", () => { const list: Point[] = [new Point(1, 1), { x: 2, y: 2 }, new Point3(3, 3, 3), new Other(4, 4, "l")]; return list.map(sum); });
add("Object.assign makes one", () => sum(Object.assign({ x: 1 }, { y: 2 })));
add("a spread makes one", () => { const base = { x: 1 }; return sum({ ...base, y: 5 }); });
add("Object.create(null) with members", () => { const o: HasX = Object.assign(Object.create(null) as {}, { x: 4 }); return getX(o); });
add("a function with members", () => { const f = Object.assign(() => 1, { x: 9 }); return getX(f); });
add("an array where an interface with length is declared", () => { const l: { length: number } = [1, 2, 3]; return l.length; });
add("a string where an interface with length is declared", () => { const l: { length: number } = "four"; return l.length; });

// unions
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "none" };
function area(s: Shape): number { switch (s.kind) { case "circle": return s.r * s.r * 3; case "square": return s.side * s.side; default: return 0; } }
add("a discriminated union", () => [area({ kind: "circle", r: 2 }), area({ kind: "square", side: 3 }), area({ kind: "none" })]);
function text(v: string | number | boolean | null | undefined | bigint | symbol): string { return typeof v === "symbol" ? "sym" : String(v); }
add("a union of primitives", () => [text("a"), text(1), text(true), text(null), text(undefined), text(5n), text(Symbol("s"))]);
function len(v: string | string[] | Set<string> | Map<string, string>): number { return typeof v === "string" ? v.length : Array.isArray(v) ? v.length : v.size; }
add("a union of built-ins", () => [len("ab"), len(["a"]), len(new Set(["a", "b", "c"])), len(new Map([["k", "v"]]))]);
type Tree = { value: number; left?: Tree; right?: Tree };
function total(t: Tree | undefined): number { return t ? t.value + total(t.left) + total(t.right) : 0; }
add("a recursive type", () => total({ value: 1, left: { value: 2 }, right: { value: 3, left: { value: 4 } } }));
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
function unwrap<T>(r: Result<T>, otherwise: T): T { return r.ok ? r.value : otherwise; }
add("a generic union", () => [unwrap({ ok: true, value: 5 }, 0), unwrap<number>({ ok: false, error: "e" }, 7), unwrap({ ok: true, value: "s" }, "")]);
add("literal types", () => { type Level = "low" | "high" | 3; const pick = (l: Level): Level => l; return [pick("low"), pick("high"), pick(3)]; });

// optional, default, rest
function opt(a: number, b?: number, c: number = 3, ...rest: number[]): number { return a + (b ?? 0) + c + rest.length; }
add("optional, default and rest parameters", () => [opt(1), opt(1, 2), opt(1, undefined, undefined), opt(1, 2, 3, 4, 5), opt(1, undefined, 4)]);
add("a spread of a tuple into parameters", () => { const args: [number, number] = [1, 2]; return opt(...args); });
add("a spread of an array into rest", () => { const more = [7, 8, 9]; return opt(1, 2, 3, ...more); });
function named({ a, b = 2, ...others }: { a: number; b?: number; c?: string; d?: boolean }): string { return a + "," + b + "," + JSON.stringify(others); }
add("a pattern as a parameter", () => [named({ a: 1 }), named({ a: 1, b: undefined }), named({ a: 1, b: 5, c: "c", d: true })]);
add("optional members set to undefined", () => { const o: { a?: number; b?: string } = { a: undefined, b: undefined }; return [o.a, o.b, "a" in o]; });
add("optional members deleted", () => { const o: { a?: number; b: string } = { a: 1, b: "b" }; delete o.a; return [o.a, Object.keys(o)]; });
add("an optional method", () => { const o: { f?(): number } = {}; const p: { f?(): number } = { f() { return 1; } }; return [o.f?.(), p.f?.()]; });

// tuples, readonly, records
add("tuples", () => { const t: [string, number, boolean?] = ["a", 1]; const u: [string, number, boolean?] = ["b", 2, true]; return [t.length, u[2], t[2]]; });
add("a labeled rest tuple", () => { const t: [first: string, ...rest: number[]] = ["a", 1, 2, 3]; const [f, ...r] = t; return [f, r]; });
add("readonly arrays", () => { const l: readonly number[] = [3, 1, 2]; return [...l].sort(); });
add("as const", () => { const c = { a: 1, b: ["x", "y"] } as const; return [c.a, c.b[1]]; });
add("a Record", () => { const r: Record<string, number> = { a: 1 }; r.b = 2; r["c d"] = 3; delete r.a; return r; });
add("a Record of a union of keys", () => { const r: Record<"a" | "b", number[]> = { a: [], b: [1] }; r.a.push(2); return r; });
add("Partial, Required, Pick, Omit", () => { type T = { a: number; b?: string; c: boolean }; const p: Partial<T> = {}; const q: Required<T> = { a: 1, b: "b", c: true }; const r: Pick<T, "a"> = q; const s: Omit<T, "a"> = { c: false }; return [p, q, r.a, s]; });
add("an index signature beside members", () => { const o: { id: number; [k: string]: number | string } = { id: 1, more: "m" }; o.other = 5; return o; });
add("number keys", () => { const o: { [k: number]: string } = { 1: "a", 2: "b" }; o[3] = "c"; return o; });
add("symbol keys", () => { const k = Symbol("k"); const o: { [k]: number; a: number } = { [k]: 1, a: 2 }; return [o[k], o.a]; });

// classes
abstract class Animal { abstract sound(): string; speak(): string { return this.sound() + "!"; } }
class Dog extends Animal { sound(): string { return "woof"; } }
class Cat extends Animal { sound(): string { return "meow"; } }
add("abstract classes", () => [new Dog(), new Cat()].map(a => a.speak()));
class Counter { #n = 0; static made = 0; constructor() { Counter.made++; } get value(): number { return this.#n; } set value(v: number) { this.#n = v; } bump(): this { this.#n++; return this; } }
add("private fields, accessors, this types, statics", () => { const c = new Counter().bump().bump(); c.value += 5; return [c.value, Counter.made > 0]; });
class Lazy { late!: number; maybe?: string; init(): void { this.late = 4; } }
add("a field asserted to be assigned, read after it is", () => { const l = new Lazy(); l.init(); return [l.late, l.maybe]; });
class Base1 { kind: string = "base"; constructor() { this.setup(); } setup(): void {} }
class Derived1 extends Base1 { extra: number = 1; override setup(): void { this.kind = "derived"; } }
add("a method called by the base constructor", () => { const d = new Derived1(); return [d.kind, d.extra]; });
class Generic<T> { items: T[] = []; add(item: T): this { this.items.push(item); return this; } first(): T | undefined { return this.items[0]; } }
add("a generic class", () => [new Generic<number>().add(1).first(), new Generic<string>().first(), new Generic<Point>().add({ x: 1, y: 2 }).first()]);
class WithIndex { [key: string]: unknown; fixed = 1; }
add("a class with an index signature", () => { const w = new WithIndex(); w.more = "m"; return w; });
add("a class expression", () => { const K = class { v = 2; }; return new K().v; });
add("instanceof narrows", () => { const f = (a: Animal | Point): string => a instanceof Animal ? a.speak() : String(a.x); return [f(new Dog()), f(new Point(1, 2))]; });
class ErrorWithCode extends Error { constructor(message: string, public code: number) { super(message); this.name = "ErrorWithCode"; } }
add("a subclass of Error", () => { try { throw new ErrorWithCode("m", 5); } catch (e) { return e instanceof ErrorWithCode ? [e.message, e.code, e.name] : "other"; } });
class Stack<T> extends Array<T> { top(): T | undefined { return this[this.length - 1]; } }
add("a subclass of Array", () => { const s = new Stack<number>(); s.push(1, 2); return [s.top(), s.length, Array.isArray(s), s.map(n => n * 2).length]; });
class Registry extends Map<string, number> { total(): number { let t = 0; for (const v of this.values()) t += v; return t; } }
add("a subclass of Map", () => { const r = new Registry(); r.set("a", 1).set("b", 2); return [r.total(), r.size]; });

// functions
add("overloads", () => { function f(a: string): string; function f(a: number): number; function f(a: string | number): string | number { return a; } return [f("s"), f(1)]; });
add("callbacks of built-ins", () => [[1, 2, 3].map(n => n * 2), [1, 2, 3].filter(n => n > 1), [1, 2, 3].reduce((a, b) => a + b, 0), [3, 1, 2].sort((a, b) => a - b), ["a", "b"].flatMap(s => [s, s]), [1, 2].find(n => n > 5), [1, 2].findIndex(n => n > 1)]);
add("reduce to another type", () => [1, 2, 3].reduce<Record<string, number>>((acc, n) => { acc["k" + n] = n; return acc; }, {}));
add("a callback that ignores parameters", () => { const each = (f: (n: number, i: number) => void): void => f(1, 2); let seen = 0; each(() => { seen++; }); each(n => { seen += n; }); return seen; });
add("a callback that returns more than void", () => { const each = (f: () => void): void => { f(); }; const l: number[] = []; each(() => l.push(1)); return l; });
add("a function returning never", () => { const fail = (m: string): never => { throw new Error(m); }; try { fail("f"); } catch (e) { return (e as Error).message; } });
add("bind, call, apply", () => { function f(this: { k: number }, a: number): number { return this.k + a; } return [f.call({ k: 1 }, 2), f.apply({ k: 3 }, [4]), f.bind({ k: 5 })(6)]; });
add("a generic identity", () => { const id = <T,>(v: T): T => v; return [id(1), id("s"), id(null), id(undefined), id([1]), id({ a: 1 })]; });
add("a generic with a constraint", () => { const longest = <T extends { length: number }>(a: T, b: T): T => a.length >= b.length ? a : b; return [longest("ab", "c"), longest([1], [2, 3])]; });
add("keyof", () => { const get = <T, K extends keyof T>(o: T, k: K): T[K] => o[k]; return [get({ a: 1, b: "s" }, "a"), get({ a: 1, b: "s" }, "b"), get([5, 6], 1), get("str", "length")]; });
add("a type predicate", () => { const isText = (v: unknown): v is string => typeof v === "string"; return [1, "a", null, "b"].filter(isText); });
add("an assertion function", () => { function assertNumber(v: unknown): asserts v is number { if (typeof v !== "number") throw new TypeError("no"); } const v: unknown = 5; assertNumber(v); return v + 1; });
add("closures over loop variables", () => { const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) fs.push(() => i); return fs.map(f => f()); });
add("a getter in a literal", () => { const o = { get v(): number { return 3; }, w: 1 }; const take = (p: { v: number; w: number }): number => p.v + p.w; return take(o); });

// enums
enum Color { Red, Green = 5, Blue }
enum Name { A = "a", B = "b" }
const enum Bits { One = 1, Two = 2, Both = One | Two }
add("enums", () => [Color.Red, Color.Blue, Color[5], Name.B, Bits.Both, Color.Red | Color.Green]);
add("an enum as a parameter", () => { const f = (c: Color): string => Color[c] ?? "none"; return [f(Color.Green), f(0), f(Color.Red | Color.Blue)]; });
add("an enum as a key", () => { const m: Record<Name, number> = { [Name.A]: 1, [Name.B]: 2 }; return m; });

// async, generators, iterators
add("async functions", async () => { const f = async (n: number): Promise<number> => n * 2; return [await f(1), await Promise.all([f(2), f(3)]), await Promise.resolve("s")]; });
add("await of what is no promise", async () => { const v: number | Promise<number> = 4; return await v; });
add("a thenable", async () => { const t: PromiseLike<number> = { then(ok) { return Promise.resolve(ok ? ok(6) : undefined) as any; } }; return await t; });
add("Promise.allSettled and race", async () => { const r = await Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("x"))]); return [r.map(x => x.status), await Promise.race([Promise.resolve("first")])]; });
add("generators", () => { function* g(n: number): Generator<number, string, boolean> { let i = 0; while (i < n) { const stop: boolean = yield i++; if (stop) break; } return "done"; } const it = g(3); return [it.next(), it.next(false), it.next(true)]; });
add("async generators", async () => { async function* g(): AsyncGenerator<number> { yield 1; yield 2; } const l: number[] = []; for await (const v of g()) l.push(v); return l; });
add("an iterable of one's own", () => { const it: Iterable<number> = { *[Symbol.iterator]() { yield 1; yield 2; } }; return [...it, ...new Set(it)]; });
add("for of over built-ins", () => { const l: string[] = []; for (const [k, v] of new Map([["a", 1]])) l.push(k + v); for (const c of "hi") l.push(c); for (const [i, v] of ["x"].entries()) l.push(i + v); return l; });
add("destructuring with defaults", () => { const { a = 1, b: { c = 2 } = {}, ...rest }: { a?: number; b?: { c?: number }; d?: string } = { d: "d" }; const [x = 5, , y = 6] = [undefined, 1] as (number | undefined)[]; return [a, c, rest, x, y]; });

// built-ins
add("Map and Set", () => { const m = new Map<string, number[]>(); (m.get("a") ?? m.set("a", []).get("a")!).push(1); const s = new Set<number>([1, 1, 2]); return [m, s, m.has("b"), s.delete(1)]; });
add("WeakMap, WeakSet", () => { const k = {}; const w = new WeakMap<object, number>([[k, 1]]); return [w.get(k), w.get({}), new WeakSet([k]).has(k)]; });
add("typed arrays", () => { const a = new Uint8Array([1, 2, 300]); const f = new Float64Array(2); f[0] = 1.5; return [[...a], [...f], a.subarray(1).length, new DataView(a.buffer).getUint8(0)]; });
add("Date", () => { const d = new Date(0); return [d.getTime(), d.toISOString(), new Date(NaN).getTime()]; });
add("RegExp", () => { const m = /(?<y>\d+)-(\d+)?/.exec("12-"); return [m?.[0], m?.[2], m?.groups?.y, "a1b2".replace(/\d/g, d => String(Number(d) + 1)), "a,b".split(","), [..."a1b2".matchAll(/\d/g)].length, "x".match(/y/)]; });
add("JSON", () => { const v: unknown = JSON.parse('{"a":[1,{"b":null}]}'); return [JSON.stringify(v), JSON.stringify({ u: undefined, f() {}, n: NaN }), JSON.stringify([undefined])]; });
add("Object functions", () => { const o = { a: 1, b: "s" }; return [Object.keys(o), Object.values(o), Object.entries(o), Object.fromEntries([["k", 1]]), Object.freeze({ z: 1 }).z, Object.getOwnPropertyNames(o)]; });
add("numbers", () => [Number("5"), parseInt("7px"), parseFloat("1.5"), (5).toFixed(1), Number.isInteger(5.5), Math.min(), 0 / 0, -0, 1 / 0, 2 ** 53, 5 % 3, 7 >>> 1, ~5]);
add("bigint", () => [5n * 2n, BigInt(7), BigInt.asUintN(8, 257n), 2n ** 64n, typeof 1n]);
add("strings", () => ["abc".at(-1), "abc".charAt(5), "abc".charCodeAt(5), "abc".codePointAt(5), "a".padStart(3, "-"), "abc"[5], "x".repeat(2), " t ".trim(), "aXb".toLowerCase(), "a-b".replaceAll("-", "+"), `t${1}${"s"}${null}${undefined}`]);
add("arrays", () => { const l = [1, 2, 3]; return [l.at(-1), l.at(9), l.pop(), [].pop(), [].shift(), l.indexOf(9), l.concat([4], 5), l.slice(1), [[1], [2, [3]]].flat(), Array.from({ length: 2 }, (_, i) => i), Array.of(7), new Array<number>(2).fill(0), l.toSorted(), l.with(0, 9), l.includes(2), l.join()]; });
add("holes", () => { const l: (number | undefined)[] = [1, , 3]; return [l[1], l.length, 1 in l, l.map(v => v ?? 0)]; });
add("Symbol", () => [Symbol.for("a") === Symbol.for("a"), Symbol("d").description, typeof Symbol.iterator]);
add("globalThis, typeof, void, comma, in, delete", () => [typeof globalThis, typeof undefined, typeof null, void 0, "a" in { a: 1 }]);
add("structuredClone", () => structuredClone({ a: [1, new Date(0)], m: new Map([[1, 2]]) }));
add("Intl and locale functions", () => [(1234.5).toLocaleString("en-US"), new Intl.NumberFormat("en-US").format(1), "a".localeCompare("b")]);
add("Proxy and Reflect", () => { const p = new Proxy({ a: 1 } as { a: number; b?: number }, { get: (t, k) => k === "b" ? 2 : Reflect.get(t, k) }); return [p.a, p.b, Reflect.ownKeys(p), Reflect.has(p, "a")]; });
add("getters on classes through interfaces", () => { class C { get v(): number { return 1; } } const take = (o: { readonly v: number }): number => o.v; return take(new C()); });
add("satisfies", () => { const c = { a: 1, b: "s" } satisfies Record<string, number | string>; return [c.a + 1, c.b.length]; });
add("unknown narrowed", () => { const f = (v: unknown): string => typeof v === "object" && v !== null && "a" in v && typeof v.a === "number" ? "has a " + v.a : "no"; return [f({ a: 1 }), f({ a: "s" }), f(null), f(5)]; });
add("nullish chains", () => { type D = { a?: { b?: { c?: number; f?(): string } | null } }; const g = (d: D): unknown[] => [d.a?.b?.c, d.a?.b?.f?.(), d.a?.b?.c ?? "none"]; return [g({}), g({ a: {} }), g({ a: { b: null } }), g({ a: { b: { c: 0, f: () => "f" } } })]; });
add("compound assignment", () => { let n: number = 1; n += 2; n *= 3; n **= 2; n %= 7; n <<= 2; let s: string = "a"; s += 1; s += null; let u: number | undefined; u ??= 5; let b: boolean = true; b &&= false; let o: string | null = null; o ||= "d"; return [n, s, u, b, o]; });
add("increments", () => { let n = 1; const o = { c: 1 }; const l = [1]; return [n++, ++n, o.c++, --o.c, l[0]++, l[0]]; });
add("labels, switch, do, while", () => { let t = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 2) continue outer; if (i === 2) break outer; t += j + 1; } } do { t++; } while (t < 5); switch (t) { case 6: t += 10; case 7: t += 100; break; default: t = -1; } return t; });
add("try, catch, finally", () => { const f = (n: number): string => { try { if (n === 1) throw new Error("e"); if (n === 2) return "returned"; return "end"; } catch { return "caught"; } finally { if (n === 3) return "finally"; } }; return [f(0), f(1), f(2), f(3)]; });
add("namespaces", () => { return [Space.value, Space.twice(2), Space.Inner.deep]; });
namespace Space { export const value = 1; export function twice(n: number): number { return n * 2; } export namespace Inner { export const deep = "d"; } }
add("declaration merging", () => { return [Merged.make().v, Merged.count]; });
class Merged { v = 1; static make(): Merged { return new Merged(); } }
namespace Merged { export const count = 2; }
add("using", () => { const log: string[] = []; { using r = { [Symbol.dispose]() { log.push("disposed"); } }; log.push("used " + typeof r); } return log; });
add("accessor keyword and static blocks", () => { class C { static s: number; static { C.s = 4; } } return C.s; });
add("tagged templates", () => { const tag = (s: TemplateStringsArray, ...v: number[]): string => s.raw.join("|") + v.join(); return tag`a${1}b${2}c`; });
add("template literal types", () => { type Id = `id-${number}`; const f = (i: Id): string => i; return f("id-5"); });
add("intersection types", () => { type A = { a: number }; type B = { b: string }; const f = (v: A & B): string => v.a + v.b; return f({ a: 1, b: "b" }); });
add("conditional and mapped types", () => { type Un<T> = T extends (infer U)[] ? U : T; const f = <T,>(v: T): Un<T> | undefined => (Array.isArray(v) ? v[0] : v) as Un<T>; type Flags<T> = { [K in keyof T]: boolean }; const g: Flags<{ a: number; b: string }> = { a: true, b: false }; return [f([1, 2]), f("s"), g]; });
add("object with a null prototype in a Record", () => { const r: Record<string, number> = Object.create(null); r.a = 1; return [r.a, Object.keys(r)]; });
add("arguments object", () => { function f(a: number, b?: number): number { return arguments.length; } return [f(1), f(1, 2)]; });
add("new.target and constructors that return", () => { class C { v = 1; constructor() { if (!new.target) throw new Error("no"); } } return new C().v; });
add("sort of objects by a key", () => { const l: { n: string; v: number }[] = [{ n: "b", v: 2 }, { n: "a", v: 1 }]; return l.sort((x, y) => x.n.localeCompare(y.n)).map(x => x.v); });
add("group by", () => { const g = Object.groupBy([1, 2, 3], n => n % 2 ? "odd" : "even"); return [g.odd, g.even]; });
add("Array.from a Map's keys", () => Array.from(new Map([["a", 1], ["b", 2]]).keys()));
add("a Map of classes", () => { const m = new Map<string, Animal>([["d", new Dog()]]); return [m.get("d")?.speak(), m.get("c")?.speak()]; });
add("a function stored in a field", () => { class H { handler: (n: number) => number = n => n; } const h = new H(); const before = h.handler(1); h.handler = n => n * 5; return [before, h.handler(1)]; });
add("null in fields", () => { class N { next: N | null = null; v: number | null = null; } const n = new N(); n.next = new N(); n.v = 0; n.next.v = null; return [n.v, n.next.v, n.next.next]; });
add("a number field takes every number", () => { class F { v: number = 0; } const f = new F(); const got: number[] = []; for (const v of [1, 1.5, -0, NaN, Infinity, 2 ** 31, -(2 ** 31) - 1, 1e300]) { f.v = v; got.push(f.v); } return got.map(v => Object.is(v, -0) ? "-0" : String(v)); });
add("an array of numbers takes every number", () => { const l: number[] = [1, 2]; l.push(1.5, NaN, -0, 2 ** 40); l[0] = 0.5; return l.map(v => Object.is(v, -0) ? "-0" : String(v)); });
add("an array grows and shrinks", () => { const l: string[] = []; l[2] = "c"; l.length = 5; l.length = 1; l.unshift("z"); return [l.length, l[0], l[1]]; });

for (const [name, f] of all) { try { console.log(name + ": " + show(await f())); } catch (e) { console.log(name + ": THROWS " + String(e).split(" (bun")[0]); } }
