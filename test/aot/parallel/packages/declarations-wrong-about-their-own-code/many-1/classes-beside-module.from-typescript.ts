// @ts-nocheck
import * as M from "own_classes_1";
const L: Record<string, any> = M;
const values = () => [
  "a", "", "abc", "1", 0, 1, -1, 2, 1.5, -0, NaN, Infinity, 2 ** 31, 2 ** 53, true, false, null, undefined, 10n, Symbol("s"),
  {}, { a: 1, b: "b" }, { b: "b", a: 1 }, { a: "1", b: 2, c: 3 }, { length: 2, 0: "a", 1: 1 }, { get a() { return "from a getter"; }, b: 0 }, Object.create({ a: "inherited", b: "inherited" }), Object.create(null),
  { x: 1, y: 2 }, { y: 2, x: 1 }, { m(x) { return [x, this === undefined]; }, inner: { a: "inner a" }, then: 1, size: "size", get: () => "got", has: () => "had" },
  [], [1, 2], ["a", 1], [1, , 3], [1.5, "x", null], new Array(3), Object.freeze([1, 2]), new Uint8Array([1, 2]), new Float64Array([1.5]),
  new String("ab"), new Number(3), new Boolean(false), Object(1n),
  Object.assign(function named(x, y) { return [x, y]; }, { toString: () => "text of named" }), Object.assign((x) => x, { toString: () => "text of an arrow" }), class C { static toString() { return "text of C"; } },
  new Map([["a", 1]]), new Set([1]), new Date(0), /a/, new URL("http://h/p?q"), new Request("http://h/r"), Promise.resolve(1), new Error("e"),
  new Proxy({}, { get: (t, k) => typeof k === "symbol" ? undefined : "proxied " + k, has: () => true }), new Proxy([1, 2], {}),
  { valueOf() { return 7; } }, { toString() { return "text of an object"; } }, { [Symbol.toPrimitive]() { return "primitive"; } },
];
const seen = (v, depth = 0) => {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "symbol" || v === undefined || v === null || typeof v === "boolean") return String(v);
  if (typeof v === "function") return "fn:" + v.name;
  if (depth > 3) return "..";
  if (Array.isArray(v)) return "[" + Array.from(v, (x) => seen(x, depth + 1)).join() + "]";
  let tag; try { tag = Object.prototype.toString.call(v).slice(8, -1); } catch { tag = "?"; }
  let names; try { names = Object.keys(v); } catch { names = []; }
  return tag + "{" + names.map((k) => { try { return k + ":" + seen(v[k], depth + 1); } catch (e) { return k + ":!" + e.name; } }).join() + "}";
};
const pending = [];
const attempt = (name, f) => {
  let said;
  try { const v = f(); if (v instanceof Promise) pending.push(v.then((x) => name + " later " + seen(x), (e) => name + " later THROWS " + (e && e.name))); said = seen(v); } catch (e) { said = "THROWS " + (e && e.name); }
  console.log(name, said);
};
const made = () => [new L.Point(1, 2), new L.Point("x", null), L.Point.of(3), new L.Old("a"), L.Old("called"), L.Old.make(5), new L.Factory(1), new L.Factory("other"), new L.Late(1), new L.Late(2), new L.Sub(4),
  new L.Generic("g"), new L.Generic(7), new L.Private(1), Object.create(L.Point.prototype), Object.assign(Object.create(L.Point.prototype), { y: "late y", x: "late x" }), new (class Point { x = "another Point"; y = 0; })(),
  new (class extends L.Point { constructor() { super(8, 9); this.own = 1; } sum() { return "overridden"; } })()];
made().forEach((o, i) => attempt("made " + i, () => o));
for (const name of ["takes_point", "takes_old", "takes_other_class", "writes_point"]) made().forEach((o, i) => attempt(name + " made " + i, () => L[name](o)));
values().forEach((v, i) => {
  attempt("new Point " + i, () => new L.Point(v, v));
  attempt("sum " + i, () => new L.Point(1, 2).sum(v));
  attempt("sum of " + i, () => new L.Point(v, 1).sum(1));
  attempt("of " + i, () => L.Point.of(v));
  attempt("first " + i, () => { const p = new L.Point(1, 2); p.first = v; return [p.first, p]; });
  attempt("sum on " + i, () => L.Point.prototype.sum.call(v, 1));
  attempt("new Old " + i, () => new L.Old(v));
  attempt("twice " + i, () => new L.Old(v).twice(v));
  attempt("Factory " + i, () => [new L.Factory(v), new L.Factory(v).who?.()]);
  attempt("Late " + i, () => new L.Late(v));
  attempt("grow " + i, () => new L.Late(1).grow(v));
  attempt("Sub " + i, () => [new L.Sub(v), new L.Sub(v).sum(v)]);
  attempt("Generic " + i, () => new L.Generic(v).put(v).get());
  attempt("Private " + i, () => [new L.Private(v).twice(v), L.Private.is(v)]);
});
attempt("gone", () => new L.Point(1, 2).gone());
attempt("z", () => new L.Point(1, 2).z);
attempt("Point()", () => L.Point(1, 2));
{ const f = L.takes_point;
  values().forEach((v, i) => attempt("takes_point " + i, () => f(v)));
  values().forEach((v, i) => attempt("takes_point a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("takes_point 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("takes_point same " + i, () => f(v, v)));
  attempt("takes_point none", () => f());
  attempt("takes_point many", () => f("a", 1, true, null, {}));
  attempt("takes_point call", () => f.call({ k: 1 }, "a"));
  attempt("takes_point length", () => [f.length, f.name]);
}
{ const f = L.takes_old;
  values().forEach((v, i) => attempt("takes_old " + i, () => f(v)));
  values().forEach((v, i) => attempt("takes_old a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("takes_old 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("takes_old same " + i, () => f(v, v)));
  attempt("takes_old none", () => f());
  attempt("takes_old many", () => f("a", 1, true, null, {}));
  attempt("takes_old call", () => f.call({ k: 1 }, "a"));
  attempt("takes_old length", () => [f.length, f.name]);
}
{ const f = L.takes_other_class;
  values().forEach((v, i) => attempt("takes_other_class " + i, () => f(v)));
  values().forEach((v, i) => attempt("takes_other_class a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("takes_other_class 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("takes_other_class same " + i, () => f(v, v)));
  attempt("takes_other_class none", () => f());
  attempt("takes_other_class many", () => f("a", 1, true, null, {}));
  attempt("takes_other_class call", () => f.call({ k: 1 }, "a"));
  attempt("takes_other_class length", () => [f.length, f.name]);
}
{ const f = L.writes_point;
  values().forEach((v, i) => attempt("writes_point " + i, () => f(v)));
  values().forEach((v, i) => attempt("writes_point a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("writes_point 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("writes_point same " + i, () => f(v, v)));
  attempt("writes_point none", () => f());
  attempt("writes_point many", () => f("a", 1, true, null, {}));
  attempt("writes_point call", () => f.call({ k: 1 }, "a"));
  attempt("writes_point length", () => [f.length, f.name]);
}
{ const f = L.makes_point;
  values().forEach((v, i) => attempt("makes_point " + i, () => f(v)));
  values().forEach((v, i) => attempt("makes_point a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("makes_point 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("makes_point same " + i, () => f(v, v)));
  attempt("makes_point none", () => f());
  attempt("makes_point many", () => f("a", 1, true, null, {}));
  attempt("makes_point call", () => f.call({ k: 1 }, "a"));
  attempt("makes_point length", () => [f.length, f.name]);
}
{ const f = L.reads_made;
  values().forEach((v, i) => attempt("reads_made " + i, () => f(v)));
  values().forEach((v, i) => attempt("reads_made a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("reads_made 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("reads_made same " + i, () => f(v, v)));
  attempt("reads_made none", () => f());
  attempt("reads_made many", () => f("a", 1, true, null, {}));
  attempt("reads_made call", () => f.call({ k: 1 }, "a"));
  attempt("reads_made length", () => [f.length, f.name]);
}
for (const line of await Promise.all(pending)) console.log(line);
