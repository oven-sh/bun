// `x instanceof C` is the first thing that is ever asked of the classes of two other CommonJS modules, which stand below each other, below a class with its own Symbol.hasInstance, and alone.
// Later a class gets another parent, a Symbol.hasInstance of its own, loses it, and a plain function gets another prototype object.
"use strict";
const bases = require("./bases.cjs");
const heirs = require("./heirs.cjs");
const log = [];
function isInstance(value, holder, name) {
  return value instanceof holder[name];
}
const names = ["Heir", "HeirOfHeir", "BelowJudged", "Alone", "Plain"];
function values() {
  return { heir: new heirs.Heir("heir"), heirOfHeir: new heirs.HeirOfHeir("heirOfHeir"), base: new bases.Base("base"), judged: { label: "judged" }, text: "judged", alone: new heirs.Alone(), plain: new heirs.Plain(), nothing: null, number: 1 };
}
function show(label) {
  const line = [];
  for (const [what, value] of Object.entries(values())) {
    let bits = "";
    for (const name of names) bits += isInstance(value, heirs, name) ? "1" : "0";
    bits += isInstance(value, bases, "Base") ? "1" : "0";
    bits += isInstance(value, bases, "Judged") ? "1" : "0";
    line.push(what + "=" + bits);
  }
  log.push(label + " " + line.join(" "));
}
for (let round = 0; round < 40; round++) {
  log.length = 0;
  show("as written");
}
Object.setPrototypeOf(heirs.Alone, bases.Judged);
show("Alone below Judged");
Object.setPrototypeOf(heirs.Alone, Function.prototype);
show("Alone alone again");
Object.defineProperty(heirs.Heir, Symbol.hasInstance, { value: value => value === 1, configurable: true });
show("Heir judges by itself");
delete heirs.Heir[Symbol.hasInstance];
show("Heir as written");
heirs.Plain.prototype = heirs.Alone.prototype;
show("Plain has the prototype of Alone");
Object.setPrototypeOf(heirs.HeirOfHeir.prototype, heirs.Alone.prototype);
show("the prototype of HeirOfHeir below that of Alone");
for (const wrong of [undefined, null, 1, "text", {}, () => {}]) {
  try {
    log.push(String(isInstance({}, { wrong }, "wrong")));
  } catch (error) {
    log.push(error.constructor.name);
  }
}
console.log(log.join("\n"), heirs.mark, heirs.Heir.count);
