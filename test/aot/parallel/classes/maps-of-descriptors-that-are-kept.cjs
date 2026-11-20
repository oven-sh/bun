// A helper makes prototypes with a map of descriptors that somebody else holds too: entries that are added, taken out, replaced or changed between two kinds are seen by the kind that is made next and by no other.
"use strict";
const entries = { stamp: { value: 1, writable: true, enumerable: true, configurable: true } };
let asked = 0;
function under(kind, above, map) {
  map.constructor = { value: kind, writable: true, enumerable: false, configurable: true };
  kind.prototype = Object.create(above.prototype, map);
  Object.setPrototypeOf(kind, above);
  return map;
}
function Base(n) { this.n = n; }
Base.prototype.sum = function () { return this.n + (this.stamp || 0) + (this.more || 0); };
const said = kind => { const proto = kind.prototype, out = []; for (const name of Object.getOwnPropertyNames(proto)) { const d = Object.getOwnPropertyDescriptor(proto, name); out.push(name + "=" + (d.get ? "get" : typeof d.value === "function" ? d.value.name : String(d.value)) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "")); } return out.join(" "); };
function kindWith(change) {
  change(entries);
  function Kind(n) { Base.call(this, n); }
  under(Kind, Base, entries);
  return Kind;
}
const kinds = [];
kinds.push(kindWith(() => {}));
kinds.push(kindWith(map => { map.stamp = { value: 10, enumerable: true }; }));
kinds.push(kindWith(map => { map.stamp.value = 20; map.stamp.writable = true; }));
kinds.push(kindWith(map => { map.more = { get() { asked++; return this.n * 100; }, configurable: true }; }));
kinds.push(kindWith(map => { delete map.stamp; }));
kinds.push(kindWith(map => { Object.defineProperty(map, "unseen", { value: { value: 9 }, enumerable: false }); }));
kinds.push(kindWith(map => { map[Symbol.for("mark")] = { value: "marked" }; map["2"] = { value: "two", enumerable: true }; map["1"] = { value: "one", enumerable: true }; }));
for (const kind of kinds) { let sums = 0; const made = []; for (let i = 0; i < 30; i++) { made.push(new kind(i)); sums += made[i].sum(); } console.log(said(kind), sums, asked, made[7].constructor === kind, Object.keys(made[3]).join(), made[0][Symbol.for("mark")]); }
// The map stays the caller's: what it holds afterwards is no prototype's.
entries.more.get = () => -1; entries.stamp = { value: 5 }; console.log(kinds.map(kind => new kind(2).sum()).join());
const held = under(function Late(n) { this.n = n; }, Base, entries); console.log(held === entries, held.constructor.value.name, new held.constructor.value(3).sum());
// Maps with getters, proxies, inherited entries and entries that are no descriptors.
let order = [];
const watched = new Proxy({ stamp: { value: 3 }, more: { value: 4 } }, { ownKeys(t) { order.push("keys"); return Reflect.ownKeys(t); }, get(t, k) { order.push("get " + String(k)); return t[k]; }, getOwnPropertyDescriptor(t, k) { order.push("own " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, set(t, k, v) { order.push("set " + String(k)); t[k] = v; return true; }, defineProperty(t, k, d) { order.push("define " + String(k)); return Reflect.defineProperty(t, k, d); } });
function Watched(n) { this.n = n; } under(Watched, Base, watched); console.log(order.join(), new Watched(1).sum());
const inheriting = Object.create({ stamp: { value: 7 } }); function Inherits(n) { this.n = n; } under(Inherits, Base, inheriting); console.log(said(Inherits), new Inherits(1).sum());
for (const bad of [{ stamp: 5 }, { stamp: null }, { stamp: { get: 1 } }, { stamp: { get() {}, value: 1 } }, Object.freeze({})]) { const kind = function (n) { this.n = n; }, before = kind.prototype; try { under(kind, Base, bad); console.log("made", said(kind)); } catch (error) { console.log(error.constructor.name, kind.prototype === before); } }
