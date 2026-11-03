// A descriptor takes its members from wherever [[Get]] finds them: its own prototype counts, `__proto__: null` cuts it off.
function list(o) {
  return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + d.value + (d.writable ? "W" : "w") : "(" + (d.get ? "G" : "g") + (d.set ? "S" : "s") + ")") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ");
}
class Point { constructor() { this.x = 1; } }
class Listed { get enumerable() { return true; } }
class ListedValue extends Listed { constructor(v) { super(); this.value = v; } }
const above = { enumerable: true, configurable: 1 };
const getterAbove = { get() { return "inherited getter"; } };
function define(o, turn) {
  const results = [];
  const attempt = f => { try { results.push(String(f())); } catch (e) { results.push(e.constructor.name + ": " + e.message); } };
  attempt(() => Object.defineProperty(o, "a1", { __proto__: above, value: turn }) === o);
  attempt(() => Object.defineProperty(o, "a2", { __proto__: null, value: turn }) === o);
  attempt(() => Object.defineProperty(o, "a3", { __proto__: getterAbove, enumerable: true }) === o);
  attempt(() => Object.defineProperty(o, "a4", { __proto__: getterAbove, value: turn }) === o);
  attempt(() => Reflect.defineProperty(o, "a5", { __proto__: above, get() { return turn; } }));
  attempt(() => Object.defineProperty(o, "a6", new ListedValue(turn)) === o);
  attempt(() => Object.defineProperty(o, "a7", Object.create(above, { value: { value: turn } })) === o);
  attempt(() => Object.defineProperties(o, { a8: { __proto__: above, value: turn }, a9: { __proto__: null, get() { return turn; } } }) === o);
  attempt(() => Object.defineProperty(o, "b1", function () {}) === o);
  attempt(() => Object.defineProperty(o, "b2", [turn]) === o);
  attempt(() => Object.defineProperty(o, "b3", Object.assign(() => {}, { value: turn, writable: true })) === o);
  return results.join(" | ");
}
for (let turn = 0; turn < 5; turn++) {
  if (turn === 3) above.writable = true;
  for (const o of [{ a: 1 }, new Point(), Object.create(null)]) console.log(turn, define(o, turn), "#", list(o));
}
