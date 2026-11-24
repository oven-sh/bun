"use strict";
let calls = 0;
function make(name) {
  const made = Object.create({ label: "above" });
  Object.defineProperty(made, "label", { enumerable: true, configurable: true, get: function () {
    calls++;
    if (calls === 9000) throw new RangeError("the getter of " + name + " throws");
    if (calls === 12001) delete this.label;
    return this === made ? name : "another receiver";
  } });
  return made;
}
const one = make("one"), other = make("other");
const heir = Object.create(one);
globalThis.kept = [one, other, heir];
function walk(turns) {
  const seen = {};
  const list = globalThis.kept;
  for (let turn = 0; turn < turns; turn++) {
    const held = list[turn % 3];
    let said;
    try { said = held.label; } catch (error) { said = error.name + ": " + error.message; }
    seen[said] = (seen[said] | 0) + 1;
  }
  return JSON.stringify(seen);
}
console.log(walk(6000)); console.log(walk(6000)); console.log(walk(6000)); console.log(calls);
