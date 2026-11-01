// Every creation of a key has the same attributes, so the layout keeps each field with them. The keys are listed. Definitions meet the objects in every state.
"use strict";
function one(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d) return k + ":none";
  return k + ("value" in d ? "=" + String(d.value) + (d.writable ? "W" : "w") : "(" + (d.get ? "G" + String(d.get.call(o)) : "g") + (d.set ? "S" : "s") + ")") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c");
}
function look(o) {
  return Reflect.ownKeys(o).join("+") + " " + Object.keys(o).join("+") + " " + one(o, "b") + " " + one(o, "c") + " " + one(o, "y") + " " + one(o, "z") + " " + ("b" in o) + " " + Object.hasOwn(o, "c") + " " + o.b + " " + o.c + " " + o.y + " " + o.z;
}
function defineGetter(made) { Object.defineProperty(made, "c", { get() { return 2; }, configurable: true }); }
function describe(made, turn) {
  let results = "";
  try { Object.defineProperty(made, "b", { value: turn, enumerable: true }); results += "k"; } catch (e) { results += "!"; }
  try { Object.defineProperty(made, "y", { value: turn, writable: true }); results += "k"; } catch (e) { results += "!"; }
  try { Object.defineProperty(made, "z", { value: 3 }); results += "k"; } catch (e) { results += "!"; }
  try { defineGetter(made); results += "k"; } catch (e) { results += "!"; }
  return results;
}
function keep(made) { return made; }
function Made() { keep(this); }
function change(o, state) {
  switch (state) {
  case 3: Object.preventExtensions(o); break;
  case 4: Object.seal(o); break;
  case 5: Object.freeze(o); break;
  case 6: Object.defineProperty(o, "b", { value: "first", enumerable: true }); break;
  case 7: defineGetter(o); break;
  case 8: Object.defineProperty(o, "z", { value: 3 }); break;
  case 9: Object.defineProperty(o, "z", { value: 4 }); break;
  case 10: Object.defineProperty(o, "y", { value: "first", writable: true }); break;
  case 11: o.other = 1; break;
  case 12: o[0] = 1; break;
  case 13: Object.create(o); break;
  case 14: Object.setPrototypeOf(o, { b: "above", c: "above" }); break;
  case 15: Object.defineProperty(o, "y", { value: "first", writable: true }); Object.defineProperty(o, "b", { value: "first", enumerable: true }); break;
  }
}
for (let round = 0; round < 3; round++) {
  for (let state = 0; state < 17; state++) {
    const made = new Made();
    change(made, state);
    const first = describe(made, state);
    const between = look(made);
    const second = describe(made, state + 100);
    let removed = "";
    try { made.y = "stored"; removed += "stored"; made.z = "stored"; } catch (e) { removed += e.constructor.name; }
    console.log(round, state, first, "|", between, "|", second, "|", look(made), "|", removed);
  }
  if (round === 1) Bun.gc(true);
}
const parent = new Made();
const child = Object.create(parent);
const seen = [];
for (let i = 0; i < 4; i++) seen.push(child.z, child.c);
describe(parent, 1);
for (let i = 0; i < 4; i++) seen.push(child.z, child.c);
try { child.z = 5; seen.push("stored"); } catch (e) { seen.push(e.constructor.name); }
console.log(seen.join());
