"use strict";
const holder = (globalThis.holder = {});
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const kind = (v) => (v === null ? "null" : typeof v);
const hide = (v) => [v][JSON.parse("0")];
function inherited(r) {
  return [kind(r.toString), kind(r.hasOwnProperty), kind(r.constructor), kind(r.valueOf), kind(r.__proto__), kind(r.isPrototypeOf), "toString" in r, "a" in r, r instanceof Object, attempt(() => r.toString()), attempt(() => r.hasOwnProperty("a")), attempt(() => String(r)), attempt(() => `${r}`), attempt(() => r + ""), attempt(() => +r), attempt(() => r == "x"), attempt(() => [r].join()), typeof r.toString === "function" ? 1 : 0, r.toString === undefined ? 1 : 0, r.toString === Object.prototype.toString ? 1 : 0, Object.getPrototypeOf(r) === null, Object.getPrototypeOf(r) === Object.prototype].join();
}
function own(r) { const listed = []; for (const key in r) listed.push(key); return [r.a, r.b, listed.join("+"), Object.keys(r).join("+"), JSON.stringify(r), JSON.stringify({ ...r }), JSON.stringify(Object.assign({}, r)), JSON.stringify(Object.entries(r)), Reflect.ownKeys(r).length, Object.prototype.toString.call(r), Object.prototype.hasOwnProperty.call(r, "a")].join(); }
const below = (a, b) => ({ __proto__: null, a, b });
const plain = (a, b) => ({ a, b });
function bothKinds() { const out = []; for (let i = 0; i < 6; i++) { const r = i & 1 ? below(i, "x") : plain(i, "y"); out.push(inherited(r), own(r)); } return out.join(" | "); }
function cutOffLater() { const r = { a: 1, b: 2 }; const before = inherited(r); Object.setPrototypeOf(r, null); const after = inherited(r); Object.setPrototypeOf(r, Object.prototype); return [before, after, inherited(r), own(r)].join(" | "); }
function cutOffByReflect() { const r = { a: 1, b: 2 }; Reflect.setPrototypeOf(r, null); const s = { a: 3, b: 4 }; s.__proto__ = null; const t = { a: 5, b: 6 }; Object.setPrototypeOf(t, hide(null)); return [inherited(r), inherited(s), Object.keys(s).join("+"), inherited(t)].join(" | "); }
function laidBelowOthersLater() {
  const seen = [];
  const r = { __proto__: null, a: 1, b: 2 };
  Object.setPrototypeOf(r, { get g() { seen.push(this === r); return this.a + 10; }, set s(v) { seen.push("set " + v); this.b = v; }, toString() { return "mine " + this.a; }, c: 3 });
  r.s = 7;
  return [r.g, r.b, r.c, String(r), `${r}`, seen.join("+"), "c" in r, Object.keys(r).join("+")].join();
}
function storesBehindTheBirth() { const r = { __proto__: null, a: 1, b: 2 }; r.c = 3; r.a = 4; r.toString = 5; r.__proto__ = 6; delete r.b; r[hide("d")] = 7; r[0] = 8; return [JSON.stringify(r), r.toString, r.__proto__, Object.getPrototypeOf(r) === null, Object.keys(r).join("+")].join(); }
function accessorsAndMethods() { const r = { __proto__: null, a: 2, get twice() { return this.a * 2; }, set twice(v) { this.a = v / 2; }, m() { return this.a + 1; }, arrow: () => kind(this) }; r.twice = 10; const loose = r.m; return [r.a, r.twice, r.m(), r.arrow(), attempt(() => loose()), r.m.call({ a: 9 }), Object.keys(r).join("+")].join(); }
function closed() { const f = Object.freeze({ __proto__: null, a: 1, b: 2 }), s = Object.seal({ __proto__: null, a: 1, b: 2 }); return [attempt(() => { f.a = 2; return f.a; }), attempt(() => { f.c = 2; return 0; }), Object.isFrozen(f), attempt(() => { s.a = 2; return s.a; }), attempt(() => { delete s.a; return 0; }), attempt(() => Object.setPrototypeOf(f, {}) && 0), attempt(() => Object.setPrototypeOf(f, null) === f), inherited(f)].join(); }
function whatIsNoRecord() {
  class C { constructor() { this.a = 1; } m() { return "m" + this.a; } }
  const c = new C(), list = [1, 2, 3], fn = function () { return 1; }, map = new Map([[1, 2]]), made = Object.create({ up: 1 });
  const before = [c.m(), list.map((x) => x * 2).join("+"), fn.call(null), map.get(1), made.up].join();
  for (const o of [c, list, fn, map, made]) Object.setPrototypeOf(o, null);
  return [before, attempt(() => c.m()), c.a, c instanceof C, attempt(() => list.map((x) => x)), list.length, list[1], attempt(() => [...list]), Array.isArray(list), attempt(() => fn.call(null)), fn(), attempt(() => map.get(1)), Map.prototype.get.call(map, 1), kind(made.up)].join();
}
function aListAlone() { const list = [1, 2, 3]; const before = list.map((x) => x * 2).join("+"); Object.setPrototypeOf(list, null); return [before, attempt(() => list.map((x) => x * 2).join("+")), attempt(() => list.push(4)), attempt(() => { let s = 0; for (const x of list) s += x; return s; }), kind(list.join), list.length, list[2]].join(); }
function anInstanceAlone() { class Point { constructor(x) { this.x = x; } twice() { return this.x * 2; } get half() { return this.x / 2; } } const point = new Point(4); const before = [point.twice(), point.half].join("+"); Object.setPrototypeOf(point, null); return [before, attempt(() => point.twice()), kind(point.half), point.x, point instanceof Point].join(); }
function aFunctionAlone() { const f = function (a) { return a + 1; }; const before = f.call(null, 1); Object.setPrototypeOf(f, null); return [before, attempt(() => f.call(null, 1)), attempt(() => f.apply(null, [1])), kind(f.bind), f(1), f.length].join(); }
function aMapAlone() { const map = new Map([[1, 2]]); const before = map.get(1); Object.setPrototypeOf(map, null); return [before, attempt(() => map.get(1)), kind(map.size), attempt(() => map.set(3, 4) && 0), Map.prototype.get.call(map, 1)].join(); }
function otherThingsWritten() { return [inherited({ __proto__: undefined, a: 1, b: 2 }), inherited({ __proto__: 5, a: 1, b: 2 }), inherited({ "__proto__": null, a: 1, b: 2 }), inherited({ ["__proto__"]: null, a: 1, b: 2 }), Object.keys({ ["__proto__"]: null, a: 1 }).join("+"), inherited({ __proto__: hide(null), a: 1, b: 2 }), inherited({ __proto__: hide(Object.prototype), a: 1, b: 2 })].join(" | "); }
async function awaited() { const r = { __proto__: null, a: 1, b: 2 }, t = { __proto__: null, a: 1, then(resolve) { resolve("own then"); } }; const later = { a: 1, b: 2 }; Object.setPrototypeOf(later, null); return [(await r) === r, await t, (await Promise.resolve(later)) === later, (await (async () => r)()) === r].join(); }
function sums(n) { let s = 0; for (let i = 0; i < n; i++) { const r = below(i, i * 2); s += r.a + r.b + (r.toString === undefined ? 1 : 1000) + ("valueOf" in r ? 1000 : 0); } return s; }
Object.assign(holder, { bothKinds, cutOffLater, cutOffByReflect, laidBelowOthersLater, storesBehindTheBirth, accessorsAndMethods, closed, whatIsNoRecord, aListAlone, anInstanceAlone, aFunctionAlone, aMapAlone, otherThingsWritten, awaited, sums });
const N = { __proto__: null, add: (a, b) => a + b, twice(x) { return this.add(x, x); }, size: 3 };
function namespace(n) { let s = 0; for (let i = 0; i < n; i++) s += N.add(i, 1) + N.twice(i) + N.size + (N.toString === undefined ? 1 : 1000); return s; }
for (let turn = 0; turn < 2; turn++) {
  for (const name of ["bothKinds", "cutOffLater", "cutOffByReflect", "laidBelowOthersLater", "storesBehindTheBirth", "accessorsAndMethods", "closed", "whatIsNoRecord", "aListAlone", "anInstanceAlone", "aFunctionAlone", "aMapAlone", "otherThingsWritten"]) console.log(name, holder[name]());
  console.log(holder.sums(300), namespace(300));
}
N.add = (a, b) => a - b; console.log(namespace(10)); Object.setPrototypeOf(N, { toString() { return "late"; } }); console.log(namespace(10), String(N));
holder.awaited().then((text) => { console.log(text); console.log({ __proto__: null, a: 1, nested: { __proto__: null } }, Bun.inspect(below(1, 2)), require("node:util").isDeepStrictEqual(below(1, 2), Object.assign(Object.create(hide(null)), { a: 1, b: 2 })), require("node:util").isDeepStrictEqual(below(1, 2), plain(1, 2))); });
