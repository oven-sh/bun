// One store and one read, each in one place, run many times on new objects; then something above the objects changes, and they run again.
function storeX(object, value) { object.x = value; }
function storeXStrict(object, value) { "use strict"; object.x = value; }
function readX(object) { return object.x; }
function readY(object) { return object.y; }
function hasX(object) { return "x" in object; }
const log = [];
class Base { m() {} }
class Derived extends Base { n() {} }
function Old() { this.a = 1; }
const kinds = {
  create: () => { const above = { a: 1 }; return { above, make: () => Object.create(above) }; },
  createTwo: () => { const top = { t: 1 }, above = Object.create(top); return { above: top, make: () => Object.create(above) }; },
  literal: () => { const above = { a: 1 }; return { above, make: () => ({ __proto__: above, b: 2 }) }; },
  derived: () => ({ above: Base.prototype, make: () => new Derived() }),
  derivedOwn: () => ({ above: Derived.prototype, make: () => new Derived() }),
  old: () => ({ above: Old.prototype, make: () => new Old() }),
  setLater: () => { const above = { a: 1 }; return { above, make: () => Object.setPrototypeOf({ b: 2 }, above) }; },
  array: () => { class List extends Array {} return { above: List.prototype, make: () => new List() }; },
  fn: () => { const above = Object.create(Function.prototype); return { above, make: () => Object.setPrototypeOf(function () {}, above) }; },
};
const events = {
  setter: above => Object.defineProperty(above, "x", { set(v) { log.push("set " + v); }, get() { return "got"; }, configurable: true }),
  readOnly: above => Object.defineProperty(above, "x", { value: "fixed", writable: false, configurable: true }),
  plain: above => { above.x = "above"; above.y = "y above"; },
  plainThenFreeze: above => { above.x = "above"; Object.freeze(above); },
  parentWithSetter: above => Object.setPrototypeOf(above, { set x(v) { log.push("far set " + v); }, get y() { return "far y"; } }),
  parentProxy: above => Object.setPrototypeOf(above, new Proxy({}, { set(t, k, v, r) { log.push("trap set " + String(k)); return true; }, get(t, k) { return typeof k === "string" ? "trap " + k : undefined; }, has(t, k) { return k === "x"; } })),
  assign: above => Object.assign(above, { x: "assigned", y: "assigned y" }),
  defineMany: above => Object.defineProperties(above, { x: { value: 1, writable: false, configurable: true }, y: { get() { return "many"; }, configurable: true } }),
  addThenRemove: above => { above.x = 1; above.y = 2; delete above.x; delete above.y; },
  manyNames: above => { for (let i = 0; i < 80; i++) above["k" + i] = i; above.y = "late y"; Object.defineProperty(above, "x", { set(v) { log.push("dictionary set " + v); }, configurable: true }); },
};
function round(label, make) {
  const row = [];
  for (let turn = 0; turn < 6; turn++) {
    const object = make(), strict = make();
    row.push(readX(object), readY(object), hasX(object));
    try { storeX(object, turn); } catch (error) { row.push(error.constructor.name); }
    try { storeXStrict(strict, turn); } catch (error) { row.push(error.constructor.name); }
    row.push(readX(object), Object.hasOwn(object, "x"), readX(strict), Object.hasOwn(strict, "x"), hasX(object));
  }
  console.log(label, row.join(" "), "|", log.splice(0).join(","));
}
for (const event of Object.keys(events)) for (const kind of Object.keys(kinds)) {
  const { above, make } = kinds[kind]();
  const names = Object.getOwnPropertyNames(above), parent = Object.getPrototypeOf(above);
  round(event + " " + kind + " before", make);
  try { events[event](above); } catch (error) { console.log(event, kind, error.constructor.name); }
  round(event + " " + kind + " behind", make);
  if (!Object.isFrozen(above)) { for (const name of Object.getOwnPropertyNames(above)) if (!names.includes(name)) delete above[name]; Object.setPrototypeOf(above, parent); }
  round(event + " " + kind + " undone", make);
}
