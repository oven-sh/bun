// Nothing in this program lists the keys of these objects, so their layouts keep no key order. Definitions meet them in every state.
"use strict";
function one(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d) return k + ":none";
  return k + ("value" in d ? "=" + String(d.value) + (d.writable ? "W" : "w") : "(" + (d.get ? "G" + String(d.get.call(o)) : "g") + (d.set ? "S" : "s") + ")") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c");
}
function look(o) {
  return [one(o, "b"), one(o, "c"), one(o, "y"), one(o, "z"), "b" in o, Object.hasOwn(o, "c"), Object.prototype.propertyIsEnumerable.call(o, "b"), o.b, o.c, o.y, o.z].join(" ");
}
function describe(made, turn) {
  const results = [];
  const attempt = f => { try { f(); results.push("ok"); } catch (e) { results.push(e.constructor.name); } };
  attempt(() => Object.defineProperty(made, "b", { value: turn, enumerable: true }));
  attempt(() => Object.defineProperty(made, "c", { get() { return 2; }, configurable: true }));
  attempt(() => Object.defineProperty(made, "y", { value: turn, writable: true }));
  attempt(() => Object.defineProperty(made, "z", { value: 3 }));
  return results.join();
}
function Made(state) { state(this); }
const states = [
  o => {}, o => {}, o => {},
  o => Object.preventExtensions(o), o => Object.seal(o), o => Object.freeze(o),
  o => { o.b = "own"; }, o => { o.c = "own"; }, o => { o.y = "own"; o.z = "own"; },
  o => { Object.defineProperty(o, "b", { value: "fixed" }); }, o => { Object.defineProperty(o, "c", { value: "fixed" }); },
  o => { Object.defineProperty(o, "z", { value: 3 }); }, o => { Object.defineProperty(o, "z", { value: 4 }); },
  o => { Object.defineProperty(o, "y", { get() { return "getter"; }, configurable: true }); },
  o => { o.other = 1; }, o => { o[0] = 1; }, o => { Object.create(o); }, o => { Object.setPrototypeOf(o, { b: "above", c: "above" }); },
  o => { o.b = 1; delete o.b; }, o => {},
];
for (let round = 0; round < 3; round++) {
  for (let index = 0; index < states.length; index++) {
    const made = new Made(states[index]);
    const first = describe(made, index);
    const between = look(made);
    const second = describe(made, index + 100);
    let stored = "";
    for (const k of ["b", "c", "y", "z"]) { try { made[k] = "stored"; stored += "s"; } catch (e) { stored += "!"; } }
    let removed = "";
    try { removed += delete made.c; removed += delete made.z; } catch (e) { removed += e.constructor.name; }
    console.log(round, index, first, "|", between, "|", second, "|", look(made), "|", stored, removed);
  }
  if (round === 1) Bun.gc(true);
}
const parent = new Made(o => {});
const child = Object.create(parent);
const seen = [];
for (let i = 0; i < 4; i++) seen.push(child.z, child.c);
describe(parent, 1);
for (let i = 0; i < 4; i++) seen.push(child.z, child.c);
try { child.z = 5; seen.push("stored"); } catch (e) { seen.push(e.constructor.name); }
console.log(seen.join());
