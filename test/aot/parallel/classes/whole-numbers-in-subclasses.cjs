// Fields of classes below built-ins that hold lengths and whole numbers, and what is stored over them: bounds of loops, keys, products.
const lines = []; let hash = 0, asked = 0;
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v !== null ? "{}" : String(v); }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 250) lines.push(s); }
function tried(title, run) { try { note(title + " " + one(run())); } catch (e) { note(title + " " + e.name); } }
globalThis.box = [0];
function hide(x) { globalThis.box[0] = x; return globalThis.box[0]; }
class Grid extends Array {
  constructor(rows, columns) {
    if (Number.isInteger(rows) && rows > 0) {
      super(rows);
      for (var i = 0; i < rows; i++) this[i] = new Array(columns).fill(i + 0.5);
    } else if (Array.isArray(rows)) {
      const list = rows; rows = list.length; columns = list[0].length;
      super(rows);
      for (i = 0; i < rows; i++) this[i] = list[i].slice();
    } else throw new TypeError("rows");
    this.rows = rows;
    this.columns = columns;
  }
  count() { let s = 0; for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) s += i * this.columns + j; return s; }
  list() { const a = []; for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) a[i * this.columns + j] = this[i] ? this[i][j] : -1; return a.join(); }
  add(other) { let s = 0; for (let i = 0; i < this.rows; i++) for (let j = 0; j < other.columns; j++) s += (this[i] ? this[i][j] : 1) + (other[i] ? other[i][j] : 2); return s; }
  last() { return this.rows > this.columns ? this.rows | 0 : this.columns >>> 0; }
  grow(by) { for (let i = 0; i < 3; i++) this.rows += by; return this.rows; }
}
class Bytes extends Uint8Array { constructor(count) { if (!Number.isInteger(count)) throw new TypeError("count"); super(count); this.count = count; } sum() { let s = 0; for (let i = 0; i < this.count; i++) s += this[i] + i * this.count; return s; } }
const made = [new Grid(3, 4), new Grid([[1, 2], [3, 4], [5, 6]])], bytes = new Bytes(5);
function round(title) {
  for (let n = 0; n < 12; n++) {
    tried(title + " count", () => hide(made)[n & 1].count()); tried(title + " list", () => hide(made)[n & 1].list());
    tried(title + " add", () => hide(made)[n & 1].add(hide(made)[1])); tried(title + " last", () => hide(made)[n & 1].last());
    tried(title + " bytes", () => hide(bytes).sum());
  }
}
round("made");
const values = [2, 2.5, -0, 1.5, NaN, "2", "x", null, undefined, true, { valueOf() { asked++; return 2; } }, 4n, [2], 3.0, -1];
for (const value of values) {
  for (const field of ["rows", "columns"]) {
    const of = made[values.indexOf(value) & 1], before = of[field];
    of[field] = value; bytes.count = value; round(field + " " + one(value)); of[field] = before; bytes.count = 5;
  }
}
tried("grow", () => hide(made)[0].grow(0.5)); round("grown"); made[0].rows = 3;
Object.defineProperty(made[0], "rows", { get() { asked += 100; return 2; }, configurable: true }); round("accessor");
delete made[0].rows; round("gone");
console.log(lines.join("\n"));
console.log(asked, hash);
