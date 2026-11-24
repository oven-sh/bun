// Fields of classes that write no types, into which the code in sight stores negations, comparisons, true and false alone. Unseen code stores what is no boolean.
// STATISTIC: FieldTypesEnforced >= 6
"use strict";
function Fruit(name, traits) {
  const has = traits || {};
  this.order = has.order;
  this.ripe = !!has.ripe;
  this.sour = !has.sour === false;
  this.dry = !(!has.dry);
  this.name = name;
}
const fruits = [new Fruit("a", { sour: true }), new Fruit("b", { ripe: 1, dry: "yes" }), new Fruit("c"), new Fruit("d", { sour: 0, ripe: true })];
class Crate {
  constructor(label, isFull, isOpen) {
    this.isOpen = isOpen === true;
    this.isFull = !!isFull;
    this.label = label;
    this.heavy = false;
  }
  load(n) {
    this.heavy = n > 2;
    return this.heavy;
  }
}
const Press = function Press(list) {
  this.turn = 0;
  this.list = list;
  this.wide = list.length > 2;
  this.open = true;
  this.jammed = false;
  this.fruit = null;
};
Press.prototype.take = function () {
  this.fruit = this.list[this.turn % this.list.length];
  this.turn += 1;
  const fruit = this.fruit;
  if (fruit.ripe && !fruit.sour) this.open = !this.open;
  this.jammed = fruit.name === "c";
  if (fruit.sour) this.open = false;
  return this.open;
};
Press.prototype.run = function (n) {
  let juice = 7;
  while (n-- > 0) {
    juice = this.take() ? juice * 2 + 1 : juice * 2;
    if (this.wide) juice &= 0xffff;
    if (this.jammed) juice ^= 5;
    if (this.fruit.dry) juice += 3;
  }
  return juice;
};
const unseen = (0, eval)(Buffer.from("KHsgc3RvcmUobywgbiwgdikgeyBvW25dID0gdiB9LCByZW1vdmUobywgbikgeyBkZWxldGUgb1tuXSB9LCBkZWZpbmUobywgbiwgZCkgeyBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgbiwgZCkgfSB9KQ==", "base64").toString());
globalThis.kept = { Fruit, fruits, Press, Crate, unseen };
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "{}" : String(v));
const state = w => ["open", "jammed", "wide"].map(n => `${show(w[n])}/${typeof w[n]}`).join(" ") + Object.keys(w).length;
const tell = (what, f) => {
  let said;
  try { said = f(); } catch (e) { said = e.constructor.name; }
  console.log(what, said);
};
for (let i = 0; i < 50; i++) new Press(fruits).run(20);
tell("plain", () => { const w = new Press(fruits); return w.run(40) + state(w); });
tell("crates", () => [new Crate("x", 1), new Crate("y", "", true), new Crate("z", {}, 1)].map(c => `${c.isFull}${c.isOpen}${c.load(3)}${c.heavy}${c.load(1)}${c.heavy}`).join());
const values = [true, false, 0, 1, -0, NaN, "", "x", 0n, 5n, null, undefined, {}, [], Symbol.iterator, 2 ** 31];
for (const name of ["open", "jammed", "wide"])
  for (const value of values)
    tell(`${name} ${typeof value === "symbol" ? "symbol" : show(value)}`, () => {
      const w = new Press(fruits);
      const first = w.run(3);
      unseen.store(w, name, value);
      const kept = typeof w[name] + (w[name] ? "t" : "f") + (w[name] === value || value !== value) + (w.open && !w.jammed && w.wide ? 1 : 2);
      const middle = w.run(6);
      unseen.store(w, name, false);
      return [first, kept, middle, w.run(5), name === "symbol" ? "" : state(w)].join(" ");
    });
for (const name of ["sour", "ripe", "dry"])
  for (const value of values)
    tell(`fruit ${name} ${typeof value === "symbol" ? "symbol" : show(value)}`, () => {
      const list = [new Fruit("a", { sour: true }), new Fruit("b", { ripe: 1 }), new Fruit("c", { dry: 1 })];
      unseen.store(list[1], name, value);
      const w = new Press(list);
      return [w.run(9), typeof list[1][name], list[1][name] ? "t" : "f", JSON.stringify(list.map(k => ({ ...k, [name]: typeof k[name] })))].join(" ");
    });
tell("removed", () => { const w = new Press(fruits); w.run(3); unseen.remove(w, "wide"); const out = w.run(4) + state(w); Press.prototype.wide = "above"; const more = w.run(4) + state(w); delete Press.prototype.wide; return out + more; });
tell("accessor", () => { const w = new Press(fruits); let n = 0; unseen.define(w, "open", { get() { return n++ % 3; }, set(v) { n += v ? 2 : 1; } }); return w.run(9) + show(n); });
tell("read-only", () => { const w = new Press(fruits); w.run(1); unseen.define(w, "jammed", { value: 1, writable: false }); return w.run(3) + state(w); });
tell("frozen", () => { const w = new Press(fruits); w.run(2); Object.freeze(w); return w.run(2); });
tell("copied", () => { const w = new Press(fruits); w.run(5); return state(Object.assign(new Press([1]), w)) + state({ ...w }) + JSON.stringify(Object.assign(Object.create(Press.prototype), w)).length; });
