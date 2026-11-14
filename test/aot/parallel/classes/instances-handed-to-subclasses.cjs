// Methods of classes below built-ins that are handed another instance, or something else that has their names or lacks them.
const lines = []; let hash = 0, asked = 0;
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "{}" : String(v); }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 220) lines.push(s); }
function tried(title, run) { try { note(title + " " + one(run())); } catch (e) { note(title + " " + e.name); } }
globalThis.box = [0];
function hide(x) { globalThis.box[0] = x; return globalThis.box[0]; }
class Grid extends Array {
  constructor(n) { super(n); for (var i = 0; i < n; i++) { this[i] = new Array(3); for (var j = 0; j < 3; j++) this[i][j] = i * 0.5 + j + 0.25; } this.n = n; }
  get(i, j) { return this[i][j]; } set(i, j, v) { this[i][j] = v; return this; }
  add(other) { for (var i = 0; i < this.n; i++) for (var j = 0; j < 3; j++) this.set(i, j, this.get(i, j) + other.get(i, j)); return this.get(0, 1); }
  sum(other) { var s = 0; for (var i = 0; i < this.n; i++) s += other.get(i, 1); return s; }
  fillOther(other) { for (var i = 0; i < this.n; i++) other.set(i, 0, i + 0.5); return other.get(0, 0); }
  list(other) { var s = ""; for (var i = 0; i < other.n; i++) s += other.get(i, 0) + ","; return s; }
  rows(other) { var s = 0; for (var i = 0; i < other.length; i++) s += other.get(i, 2); return s; }
  below(other) { for (var i = 0; i < this.n; i++) if (other.get(i, 0) > this.get(i, 0)) return i; return -1; }
}
class Bytes extends Float64Array { constructor(n) { super(n); for (var i = 0; i < n; i++) this[i] = i + 0.5; this.n = n; } get(i, j) { return this[i] + j; } set(i, j, v) { this[i] = v; } sum(other) { var s = 0; for (var i = 0; i < this.n; i++) s += other.get(i, 1) + this.get(i, 0); return s; } }
class Table extends Map { constructor(n) { super(); for (var i = 0; i < n; i++) super.set(i, i * 2); this.n = n; } get(i, j) { return super.get(i) + (j || 0); } sum(other) { var s = 0; for (var i = 0; i < this.n; i++) s += other.get(i, 1); return s; } }
class Below extends Grid { get(i, j) { asked++; return 7; } }
class Other { constructor() { this.n = 2; this.length = 2; } get(i, j) { asked++; return i - j; } set() { asked += 2; } }
const grids = [new Grid(3), new Grid(2)], bytes = new Bytes(4), table = new Table(3);
const others = [new Grid(3), new Grid(3), bytes, table, new Below(3), new Other(), { n: 2, length: 1, get(i, j) { asked += 3; return i + j * 10; }, set() { } }, new Map([[0, 1], [1, 2], [2, 3]]), [[1, 2, 3]], null, undefined, 5, "text",
  { get get() { asked += 5; return (i, j) => i; }, set: 3, n: 2, length: 2 }, new Proxy(new Grid(3), { get(t, k) { asked++; return Reflect.get(t, k); } }), Object.create(Grid.prototype), Object.assign(new Grid(3), { get: (i, j) => 100 }), Object.setPrototypeOf(new Grid(3), { get() { return 3; }, set() { }, n: 1 })];
const methods = ["add", "sum", "fillOther", "list", "rows", "below"];
function round(title, times) {
  for (let n = 0; n < times; n++) for (let k = 0; k < others.length; k++) {
    for (const method of methods) tried(title + " " + method + " " + k, () => hide(grids)[n & 1][method](hide(others)[k]));
    tried(title + " bytes " + k, () => hide(bytes).sum(hide(others)[k])); tried(title + " table " + k, () => hide(table).sum(hide(others)[k]));
  }
}
for (let n = 0; n < 60; n++) for (const method of methods) tried(method, () => hide(grids)[0][method](hide(grids)[1]) + hide(grids)[1][method](hide(others)[0]));
round("first", 6);
hide(others)[0].get = (i, j) => 9; round("own", 3); delete others[0].get;
const get = Grid.prototype.get;
Grid.prototype.get = function (i, j) { asked += 7; return 1; }; round("replaced", 3); Grid.prototype.get = get; round("back", 2);
Object.defineProperty(Grid.prototype, "get", { get() { asked += 11; return get; }, configurable: true }); round("accessor", 2);
console.log(lines.join("\n")); console.log(asked, hash);
