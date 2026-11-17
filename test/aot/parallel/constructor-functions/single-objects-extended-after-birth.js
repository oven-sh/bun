// Classes of one or a few objects, and heirs of a class that code in sight does not construct: unknown code gives their objects names and elements after their birth.
class Counter { constructor() { this.x = 7; this.run = () => this.x; } }
function Cursor(text) { this.text = text; this.pos = 0; }
Cursor.prototype.step = function () { const at = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; return this.pos++ - at; };
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) n += this.step(); return n; };
function Locale(config) { if (config != null) this.set(config); }
Locale.prototype.set = function (config) { for (const key in config) { const value = config[key]; if (typeof value === "function") this[key] = value; else this["_" + key] = value; } this._config = config; };
Locale.prototype.month = function (k) { return this._months[k] + this._name; };
const state = Symbol("state");
const heir = Base => class extends Base { constructor(text) { super(text); this[state] = { n: 1 }; } all() { return super.all() + this[state].n; } };
globalThis.store = (o, k, v) => { o[k] = v; };
globalThis.read = (o, k) => o[k];
globalThis.make = kind => kind === 0 ? new Counter : kind === 1 ? new Cursor("a bc def") : new Locale({ name: "en", months: ["jan", "feb"], ordinal(n) { return n + "th"; } });
const { store, read, make } = globalThis;
store({}, "q", 1);
const names = ["alpha", "beta", "gamma"].map(name => (name + "!").slice(0, -1));
const objects = [make(0), make(1), make(2), make(0)];
let sum = 0;
for (let i = 0; i < 400; i++) {
  for (const o of objects) { store(o, i & 7, i); store(o, names[i % 3], i); sum += read(o, i & 7) + read(o, names[i % 3]); }
  sum += objects[0].run() + objects[3].run() + read(objects[0], "x") + objects[2].month(i & 1).length + objects[2].ordinal(i).length;
  const Heir = heir(i & 1 ? Cursor : heir(Cursor)), o = new Heir("some text to be parsed");
  sum += o.all();
  if (i % 50 === 0) { store(o, names[1], i); console.log(Reflect.ownKeys(o).map(String).join(), o instanceof Cursor, read(o, names[1])); }
  if (i % 100 === 0) Bun.gc(true);
}
console.log(sum, objects.map(o => Object.keys(o).join()).join(" | "));
for (const o of objects) { delete o[3]; delete o[names[0]]; store(o, names[0], 0.5); Object.defineProperty(o, "hidden", { value: 1 }); console.log(JSON.stringify(o), Object.getOwnPropertyNames(o).join(), read(o, 3), read(o, names[0])); }
Object.freeze(objects[0]); try { (function () { "use strict"; objects[0].late = 1; })(); } catch (e) { console.log(e.name); }
console.log(Object.isFrozen(objects[0]), new Counter().run(), Object.keys(new Cursor("x")).join());
