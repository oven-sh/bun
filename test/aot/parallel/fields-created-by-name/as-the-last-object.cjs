// A store by label that creates a field of an object nobody knows does what the same store did to the last object in the same state.
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
function Stool(wood, legs, weight) { this.ok = false; this.list = undefined; this.load = 1.5; this.nails = 0; this.weight = weight; this.mark = ""; this.wood = wood; this.below = null; this.label = undefined; this.legs = legs; }
function Plank(wood, legs) { this.next = undefined; this.below = undefined; this.legs = legs; this.wood = wood; }
class Late { constructor(n) { this.n = n; } }
class Other extends Late { constructor(n) { super(n); this.other = n; } }
const makers = [() => Stool, () => Plank, () => Late, () => Other];
const hidden = JSON.parse('["Stool","Plank","Late","Other"]').map((n, i) => makers[i]());
const make = (i, ...rest) => new (hidden[i])(...rest);
function nailed(stool, weight, below) { stool.next = undefined; stool.extra = weight; stool.below = below; stool.weight = weight; return stool; }
function mark(o, v) { o.first = v; o.second = v; o.third = o; o.fourth = "t" + v; o.fifth = undefined; o.sixth = null; o.seventh = v * 1.5; o.n = v; return o; }
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.get ? "~" : "=" + (d.value && typeof d.value === "object" ? "{}" : String(d.value))) + (d.writable ? "" : "r") + (d.enumerable ? "" : "h"); }).join();
const values = [1, 2.5, "s", undefined, null, true, {}, [], () => 1, -0, NaN, 2 ** 40, 10n, Symbol.iterator];
let last = null;
for (let round = 0; round < 60; round++) {
  const a = make(0, round, round + 1, round + 2), b = make(1, round, values[round % values.length]), c = make(2, values[round % values.length]), d = make(3, round);
  nailed(a, round, last); nailed(b, values[(round * 5) % values.length], a); last = round % 4 ? a : null;
  mark(c, round % 7 === 6 ? "mark" : round); mark(d, round);
  if (round % 10 === 9) console.log([a, b, c, d].map(show).join("\n"));
  a.label = b; a.list = [c]; b.next = d; a.mark = values[round % values.length]; a.load = values[(round * 3) % values.length]; a.ok = values[(round + 1) % values.length];
  if (round % 15 === 14) console.log(show(a), show(b));
}
// Fields that go and come back, objects that are closed, prototypes that answer stores.
const log = [];
const changes = [o => { delete o.first; }, o => Object.preventExtensions(o), o => Object.seal(o), o => Object.freeze(o), o => Object.defineProperty(o, "second", { value: 1, writable: false, configurable: true }), o => Object.setPrototypeOf(o, { set third(v) { log.push("third"); }, get fourth() { return 4; } }),
  o => Object.setPrototypeOf(o, Object.freeze({ fifth: 1 })), o => Object.setPrototypeOf(o, null), o => Object.setPrototypeOf(o, new Proxy({}, { set(t, k, v, r) { log.push(k); return Reflect.set(t, k, v, r); } })), o => { o[7] = 1; }, o => Object.defineProperty(o, "first", { get() { return 9; }, configurable: true }), o => {}];
for (let round = 0; round < 48; round++) {
  const o = make(2 + round % 2, round);
  changes[round % changes.length](o);
  for (const key of ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"]) { const v = values[(round + key.length) % values.length]; log.push(attempt(() => { switch (key) { case "first": o.first = v; break; case "second": o.second = v; break; case "third": o.third = v; break; case "fourth": o.fourth = v; break; case "fifth": o.fifth = v; break; case "sixth": o.sixth = v; break; default: o.seventh = v; } return "ok"; })); }
  console.log(show(o), log.splice(0).join());
}
// The prototype of all of them changes in between.
for (let round = 0; round < 12; round++) {
  if (round === 4) Object.defineProperty(Plank.prototype, "next", { set(v) { log.push("set " + String(v)); }, get() { return "got"; }, configurable: true });
  if (round === 6) delete Plank.prototype.next;
  if (round === 8) Object.defineProperty(Stool.prototype, "extra", { value: 1, writable: false, configurable: true });
  if (round === 10) delete Stool.prototype.extra;
  const a = make(0, round, 1, 2), b = make(1, round, 3);
  console.log(attempt(() => show(nailed(a, round, b))), attempt(() => show(nailed(b, round, null))), log.splice(0).join());
}
