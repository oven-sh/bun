// One definition site meets objects of one layout in different states: open, closed, sealed, frozen, a prototype, with the name present.
"use strict";
function list(o) {
  return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + d.value + (d.writable ? "W" : "w") : "()") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ");
}
function hide(o, v) {
  try { Object.defineProperty(o, "hidden", { value: v, writable: true, configurable: true }); return "ok"; } catch (e) { return e.constructor.name + ": " + e.message; }
}
function lock(o, v) {
  try { Object.defineProperty(o, "locked", { value: v }); return "ok"; } catch (e) { return e.constructor.name + ": " + e.message; }
}
function getter(o, v) {
  try { Object.defineProperty(o, "got", { get() { return v; }, enumerable: true }); return "ok"; } catch (e) { return e.constructor.name + ": " + e.message; }
}
const make = () => ({ a: 1, b: 2 });
const states = [
  o => o,
  o => o,
  o => o,
  o => Object.preventExtensions(o),
  o => o,
  o => Object.seal(o),
  o => o,
  o => Object.freeze(o),
  o => o,
  o => { o.hidden = "own"; return o; },
  o => { o.locked = "own"; return o; },
  o => { o.got = "own"; return o; },
  o => { Object.defineProperty(o, "hidden", { value: "fixed" }); return o; },
  o => { Object.defineProperty(o, "locked", { value: "fixed" }); return o; },
  o => { Object.defineProperty(o, "got", { get() { return "fixed"; } }); return o; },
  o => { delete o.a; return o; },
  o => { o.other = 1; return o; },
  o => { o[0] = "zero"; return o; },
  o => { Object.setPrototypeOf(o, null); return o; },
  o => { Object.setPrototypeOf(o, { hidden: "above", locked: "above", got: "above" }); return o; },
  o => { Object.setPrototypeOf(o, new Proxy({}, { defineProperty() { throw new Error("trap"); }, get(t, k) { return "proxy:" + String(k); } })); return o; },
  o => o,
];
for (let round = 0; round < 3; round++) {
  for (let index = 0; index < states.length; index++) {
    const o = states[index](make());
    const results = [hide(o, index), lock(o, index), getter(o, index), hide(o, index + 100), lock(o, index + 100), getter(o, index + 100)];
    console.log(round, index, results.join(" | "), "#", list(o), "#", o.hidden, o.locked, o.got, Object.keys(o).join());
  }
  if (round === 1) Bun.gc(true);
}
