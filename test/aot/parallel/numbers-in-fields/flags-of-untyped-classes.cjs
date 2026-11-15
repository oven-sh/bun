// Fields of classes that write no types, into which the code in sight stores negations, comparisons, true and false alone. Unseen code stores what is no boolean.
// STATISTIC: FieldTypesEnforced >= 6
"use strict";
const Kind = function Kind(label, conf) {
  if (conf === void 0) conf = {};
  this.label = label;
  this.before = !!conf.before;
  this.starts = !!conf.starts;
  this.loop = !!conf.loop;
  this.order = conf.order;
};
const kinds = [new Kind("a", { before: true }), new Kind("b", { starts: 1, loop: "yes" }), new Kind("c"), new Kind("d", { before: 0, starts: true })];
class Context {
  constructor(token, isExpr, keeps) {
    this.token = token;
    this.isExpr = !!isExpr;
    this.keeps = keeps === true;
    this.deep = false;
  }
  enter(n) {
    this.deep = n > 2;
    return this.deep;
  }
}
const Walker = function Walker(list) {
  this.list = list;
  this.at = 0;
  this.allowed = true;
  this.escaped = false;
  this.last = null;
  this.found = list.length > 2;
};
Walker.prototype.step = function () {
  const kind = this.list[this.at++ % this.list.length];
  this.escaped = kind.label === "c";
  if (kind.before && !this.escaped) this.allowed = false;
  else if (kind.starts) this.allowed = !this.allowed;
  this.last = kind;
  return this.allowed;
};
Walker.prototype.run = function (n) {
  let out = 0;
  for (let i = 0; i < n; i++) {
    out = out * 2 + (this.step() ? 1 : 0);
    if (this.escaped) out ^= 5;
    if (this.last.loop) out += 3;
    if (this.found) out &= 0xffff;
  }
  return out;
};
const unseen = (0, eval)(Buffer.from("KHsgc3RvcmUobywgbiwgdikgeyBvW25dID0gdiB9LCByZW1vdmUobywgbikgeyBkZWxldGUgb1tuXSB9LCBkZWZpbmUobywgbiwgZCkgeyBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgbiwgZCkgfSB9KQ==", "base64").toString());
globalThis.kept = { Kind, kinds, Walker, Context, unseen };
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "{}" : String(v));
const state = w => ["allowed", "escaped", "found"].map(n => `${show(w[n])}/${typeof w[n]}`).join(" ") + Object.keys(w).length;
const tell = (what, f) => {
  let said;
  try { said = f(); } catch (e) { said = e.constructor.name; }
  console.log(what, said);
};
for (let i = 0; i < 50; i++) new Walker(kinds).run(20);
tell("plain", () => { const w = new Walker(kinds); return w.run(40) + state(w); });
tell("contexts", () => [new Context("x", 1), new Context("y", "", true), new Context("z", {}, 1)].map(c => `${c.isExpr}${c.keeps}${c.enter(3)}${c.deep}${c.enter(1)}${c.deep}`).join());
const values = [true, false, 0, 1, -0, NaN, "", "x", 0n, 5n, null, undefined, {}, [], Symbol.iterator, 2 ** 31];
for (const name of ["allowed", "escaped", "found"])
  for (const value of values)
    tell(`${name} ${typeof value === "symbol" ? "symbol" : show(value)}`, () => {
      const w = new Walker(kinds);
      const first = w.run(3);
      unseen.store(w, name, value);
      const kept = typeof w[name] + (w[name] ? "t" : "f") + (w[name] === value || value !== value) + (w.allowed && !w.escaped && w.found ? 1 : 2);
      const middle = w.run(6);
      unseen.store(w, name, false);
      return [first, kept, middle, w.run(5), name === "symbol" ? "" : state(w)].join(" ");
    });
for (const name of ["before", "starts", "loop"])
  for (const value of values)
    tell(`kind ${name} ${typeof value === "symbol" ? "symbol" : show(value)}`, () => {
      const list = [new Kind("a", { before: true }), new Kind("b", { starts: 1 }), new Kind("c", { loop: 1 })];
      unseen.store(list[1], name, value);
      const w = new Walker(list);
      return [w.run(9), typeof list[1][name], list[1][name] ? "t" : "f", JSON.stringify(list.map(k => ({ ...k, [name]: typeof k[name] })))].join(" ");
    });
tell("removed", () => { const w = new Walker(kinds); w.run(3); unseen.remove(w, "found"); const out = w.run(4) + state(w); Walker.prototype.found = "above"; const more = w.run(4) + state(w); delete Walker.prototype.found; return out + more; });
tell("accessor", () => { const w = new Walker(kinds); let n = 0; unseen.define(w, "allowed", { get() { return n++ % 3; }, set(v) { n += v ? 2 : 1; } }); return w.run(9) + show(n); });
tell("read-only", () => { const w = new Walker(kinds); w.run(1); unseen.define(w, "escaped", { value: 1, writable: false }); return w.run(3) + state(w); });
tell("frozen", () => { const w = new Walker(kinds); w.run(2); Object.freeze(w); return w.run(2); });
tell("copied", () => { const w = new Walker(kinds); w.run(5); return state(Object.assign(new Walker([1]), w)) + state({ ...w }) + JSON.stringify(Object.assign(Object.create(Walker.prototype), w)).length; });
