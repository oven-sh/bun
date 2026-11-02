interface T { a?: number; b: number; c?: string; d?: unknown }
interface Numbers { i: number; f: number; z: number; n: number; big: number; neg: number }
interface Odd { __proto__x: number; "with space": number; "ключ": number; constructor: number; toString: number }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } }
class Heir extends Base { w = "w"; #secret = 1; get secret() { return this.#secret; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => v === undefined ? "undefined" : typeof v === "number" && (v !== v || Object.is(v, -0) || !isFinite(v)) ? "number " + (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function entries(x: any) { return Object.entries(x); }
function pairs(x: any) { const out: unknown[] = []; for (const [k, v] of Object.entries(x)) out.push(k, v); return out; }
function mapped(x: any) { return Object.entries(x).map(([k, v]) => k + "=" + String(v)); }
function assigned(x: any) { return Object.assign({}, x); }
function assignedTwo(x: any, y: any) { return Object.assign({}, x, y); }
function owns(x: any) { return [Object.hasOwn(x, "a"), Object.hasOwn(x, "b"), Object.hasOwn(x, "c"), Object.hasOwn(x, "d"), Object.hasOwn(x, "zz"), Object.hasOwn(x, "toString"), Object.hasOwn(x, "constructor"), Object.hasOwn(x, "v"), Object.hasOwn(x, "w"), Object.hasOwn(x, "twice"), Object.hasOwn(x, "method"), Object.hasOwn(x, "secret"), Object.hasOwn(x, "length")]; }
const every = (x: unknown) => [entries(x), pairs(x), mapped(x), assigned(x), owns(x)];
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
show("a record", () => every({ b: 1 } as T));
show("again, and others of its shape", () => [every({ b: 1 } as T), every({ b: 2 } as T), every({ b: 3 } as T)]);
show("optional fields: set, undefined, deleted", () => { const x: T = { a: 1, b: 1 }, y: T = { a: undefined, b: 1 }, z: T = { a: 1, b: 1 }; delete z.a; return [every(x), every(y), every(z)]; });
show("optional fields in turn, one site", () => { const list: T[] = [{ b: 1 }, { a: 1, b: 1 }, { b: 1 }, { b: 1, c: "c" }, { a: 1, b: 1, c: "c" }, { b: 1 }]; return list.map(owns); });
show("orders differ", () => { const x: T = { b: 1 }, y: T = { b: 1 }; x.a = 1; x.c = "c"; y.c = "c"; y.a = 1; return [every(x), every(y)]; });
show("a field set after the first look", () => { const x: T = { b: 1 }; const first = every(x); x.a = 5; const second = every(x); delete x.a; return [first, second, every(x)]; });
show("numbers", () => every({ i: 1, f: 1.5, z: -0, n: NaN, big: 2147483648, neg: -2147483649 } as Numbers));
show("values of every kind", () => every({ b: 1, d: [null, true, "s", { b: 2 } as T, () => 1, Symbol("s")] } as T));
show("names", () => [entries({ __proto__x: 1, "with space": 2, "ключ": 3, constructor: 4, toString: 5 } as Odd), assigned({ __proto__x: 1, "with space": 2, "ключ": 3, constructor: 4, toString: 5 } as Odd), owns({ __proto__x: 1, "with space": 2, "ключ": 3, constructor: 4, toString: 5 } as Odd)]);
show("instances", () => [every(new Base(1)), every(new Heir(2))]);
show("extras: a string, an index, a symbol, hidden, an accessor", () => { const x: T = { b: 1 }; hide(x).zz = 1; const one = every(x); hide(x)[0] = "zero"; const two = every(x); hide(x)[Symbol.for("s")] = 2; Object.defineProperty(hide(x), "hidden", { value: 1, enumerable: false }); Object.defineProperty(hide(x), "got", { get() { return "got " + this.b; }, enumerable: true }); return [one, two, every(x)]; });
show("an extra that is deleted again", () => { const x: T = { b: 1 }; hide(x).zz = 1; delete hide(x).zz; return every(x); });
show("frozen, sealed, closed", () => [Object.freeze({ a: 1, b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)].map(every));
show("another prototype, a null prototype", () => [Object.setPrototypeOf({ b: 1 } as T, plain(["zz", 1], ["a", 2])), Object.setPrototypeOf({ b: 2 } as T, null)].map(x => [entries(x), pairs(x), assigned(x), Object.hasOwn(x, "zz"), Object.hasOwn(x, "a"), Object.hasOwn(x, "b")]));
show("empty", () => [every({} as { o?: number }), every({ o: undefined } as { o?: number })]);
show("typed and plain in turn, one site", () => [{ b: 1 } as T, plain(["b", 1]), { a: 1, b: 2 } as T, plain(["zz", 1]), new Base(1), [1, 2], "ab", { b: 3 } as T].map(x => [entries(x), pairs(x), assigned(x), owns(x)]));
show("what comes back is fresh and ordinary", () => { const x: T = { a: 1, b: 2 }; const e = entries(x), f = entries(x), c = assigned(x); e[0][1] = "changed"; e.push(["more", 1]); c.b = "changed"; c.more = 1; delete c.a; return [e, f, c, x, e !== f, e[0] !== f[0], Object.getPrototypeOf(c) === Object.prototype, Object.isExtensible(c), Array.isArray(e[1]), e[1].length, Object.keys(c)]; });
show("the copy does not follow the source", () => { const x: T = { b: 1, d: { b: 2 } as T }; const c = assigned(x); x.b = 9; (x.d as T).b = 9; return [c, c.d === x.d]; });
show("two sources", () => [assignedTwo({ a: 1, b: 1 } as T, { b: 2, c: "c" } as T), assignedTwo({ b: 1 } as T, plain(["b", 2], ["zz", 3])), assignedTwo(plain(["b", 2], ["zz", 3]), { a: 1, b: 1 } as T), assignedTwo({ b: 1 } as T, null), assignedTwo(undefined, { b: 1 } as T)]);
show("not objects", () => [1, "ab", true, 10n, Symbol("s")].map(x => [entries(x), assigned(x), Object.hasOwn(hide(x), "length"), Object.hasOwn(hide(x), "b")]));
show("null and undefined", () => [null, undefined].map(x => { const out: string[] = []; for (const f of [entries, pairs, owns]) { try { f(x); out.push("no error"); } catch (e) { out.push((e as Error).name); } } return [out, assigned(x)]; }));
show("many fields", () => every({ f01: 1, f02: 2, f03: 3, f04: 4, f05: 5, f06: 6, f07: 7, f08: 8, f09: 9, f10: 10, f11: 11, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20 }));
show("many objects", () => { let n = 0; for (let i = 0; i < 3000; i++) { const x: T = i & 1 ? { a: i, b: i } : { b: i }; n += entries(x).length + pairs(x).length + Object.keys(assigned(x)).length + +Object.hasOwn(hide(x), "a") + +Object.hasOwn(hide(x), "zz"); } return n; });
