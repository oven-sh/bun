// Accessors that __defineGetter__, a descriptor from elsewhere or a constructor function defines are expected in loops, before their site has learned.
// STATISTIC: SettersExpectedInLoops >= 2
// STATISTIC: GettersExpectedInLoops >= 3
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const lines = [];
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
const tell = (...fs) => lines.push(fs.map(attempt).join(" "));

const o = { v: 1, w: 2 };
o.__defineGetter__("size", function () { return this.v; });
o.__defineSetter__("size", function (x) { this.v = x; });
function ofObject(turns) { let n = 0; for (let k = 0; k < turns; k++) { o.size = k & 3; n += o.size + o.w; } return n; }

const shared = { enumerable: true, configurable: true, get: () => 0, set: () => {} };
function proxy(target, source, key) {
  shared.get = function () { return this[source][key]; };
  shared.set = function (x) { this[source][key] = x; };
  Object.defineProperty(target, key, shared);
}
class Component { constructor(data) { this.data = data; for (const key of Object.keys(data)) proxy(this, "data", key); } }
const component = new Component({ count: 0, total: 1 });
function ofComponent(turns) { let n = 0; for (let k = 0; k < turns; k++) { component.count = k & 7; n += component.count + component.total; } return n; }

function Cell(v) { this.v = v; Object.defineProperty(this, "twice", { get: function () { return this.v * 2; }, set: function (x) { this.v = x / 2; }, configurable: true }); }
const cells = [new Cell(1), new Cell(2.5)];
function ofCells(turns) { let n = 0; for (let k = 0; k < turns; k++) { const c = cells[k % cells.length]; c.twice = k; n += c.twice + c.v; } return n; }

class Model { constructor(attributes) { this.attributes = attributes; this.changes = 0; } }
function attributesOf(target, names) { for (const name of names) Object.defineProperty(target, name, { configurable: true, get() { return this.attributes[name]; }, set(x) { this.attributes[name] = x; this.changes++; } }); }
attributesOf(Model.prototype, ["title", "size"]);
const models = [new Model({ title: "a", size: 1 }), new Model({ title: "bb", size: 2 })];
function ofModels(turns) { let n = 0; for (let k = 0; k < turns; k++) { const m = models[k & 1]; m.size = k & 7; n += m.size + m.title.length; } return n + " " + models.map((m) => m.changes); }
function ofFirst(turns) { let n = 0; for (const m of [models[0], models[1], models[0]]) for (let k = 0; k < turns; k++) n += m.size; return n; }

const redefine = (target, key, descriptor) => Object.defineProperty(target, key, descriptor);
const all = () => tell(() => ofObject(0), () => ofObject(1), () => ofObject(50), () => ofComponent(1), () => ofComponent(60), () => ofCells(1), () => ofCells(40), () => ofModels(1), () => ofModels(30), () => ofFirst(9));
all(); all();
redefine(o, "size", { get: () => -1, set() {}, configurable: true }); all();
redefine(o, "size", { value: 5, writable: true, configurable: true }); all();
redefine(o, "size", { get: () => 2, set(x) { throw new RangeError("size " + x); }, configurable: true }); all();
delete o.size; o.size = 3; all();
component.data = { count: "s", total: 0.5 }; all();
redefine(component.data, "count", { get() { return 7; }, set(x) { lines.push("inner " + x); }, configurable: true }); all();
component.data = null; all();
component.data = { total: 2, count: 1 }; Object.freeze(component.data); all();
cells.push(new Cell("t"), { v: 1, twice: 2 }, Object.create(cells[0])); all();
redefine(cells[0], "twice", { get() { return 1000; }, configurable: true }); all();
models[1] = new (class extends Model { get size() { return -5; } set size(x) { this.changes += 100; } })({ title: "sub", size: 3 }); all();
redefine(models[0], "size", { value: 1, writable: false }); all();
models.reverse(); all();
redefine(Model.prototype, "title", { get() { return undefined; } }); all();
models[0] = new Proxy(models[0], { set(t, k, v, r) { lines.push("trap " + String(k)); t.attributes.size = v; return true; } }); tell(() => ofModels(4));
console.log(lines.join("\n"));
