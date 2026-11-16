// A matrix in a field, beside a matrix that extends Array.
class Field { constructor(r, c) { this.d = []; for (var i = 0; i < r; i++) { this.d.push([]); for (var j = 0; j < c; j++) this.d[i].push(0.5); } this.rows = r; } set(i, j, v) { this.d[i][j] = v; return this; } get(i, j) { return this.d[i][j]; } }
var field = new Field(4, 4); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) field.set(i, j, i * 4 + j + 0.5);
class Extended extends Array { constructor(r, c) { super(r); for (var i = 0; i < r; i++) this[i] = new Array(c); this.rows = r; } set(i, j, v) { this[i][j] = v; return this; } get(i, j) { return this[i][j]; } }
var extended = new Extended(4, 4); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) extended.set(i, j, i * 4 + j + 0.5);
function mixin(S) { return class extends S { get cols() { return this.columns; } }; }
class Mixed extends mixin(Array) { constructor(r, c) { super(r); for (var i = 0; i < r; i++) this[i] = new Array(c); this.rows = r; } set(i, j, v) { this[i][j] = v; return this; } get(i, j) { return this[i][j]; } }
var mixed = new Mixed(4, 4); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) mixed.set(i, j, i * 4 + j + 0.5);
function multiplies(S) {
  if (S === undefined) S = Object;
  class Multiplies extends S {
    get(i, j) { throw new Error("get"); }
    apply(callback) { for (var i = 0; i < this.rows; i++) for (var j = 0; j < this.columns; j++) callback.call(this, i, j); return this; }
    turned() { return new Turned(this); }
    product(n) { var column = [0.5, 1.5, 2.5, 3.5], columns = this.columns, t = 0; for (var r = 0; r < n; r++) { var s = 0; for (var k = 0; k < columns; k++) s += this.get(r & 3, k) * column[k]; t += s; } return t; }
  }
  return Multiplies;
}
class Turned extends multiplies() { constructor(matrix) { super(); this.matrix = matrix; this.rows = matrix.columns; this.columns = matrix.rows; } get(i, j) { return this.matrix.get(j, i); } }
class Rows extends multiplies(Array) { constructor(r, c) { super(r); for (var i = 0; i < r; i++) { this[i] = new Array(c); for (var j = 0; j < c; j++) this[i][j] = i + j * 0.5; } this.rows = r; this.columns = c; } get(i, j) { return this[i][j]; } }
var rows = new Rows(4, 4); rows.turned().product(2);
class Layer { constructor(table, name) { const act = table[name].act, der = table[name].der; this.act = function (i, j) { this[i][j] = act(this[i][j]); }; this.der = function (i, j) { this[i][j] = der(this[i][j]); }; } }
const table = { half: { act: value => value / 2, der: value => 1 - value * value }, root: { act: Math.cbrt, der: Math.atan }, same: { act: value => value, der: () => 1 } };
var layer = new Layer(table, process.argv[7] || "half"), other = new Layer(table, "root"), mapped = new Rows(16, 16);
new Rows(2, 2).apply(other.act).apply(other.der);
function nest(d, n) { for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) d[i][j] = 1 - d[i][j] * d[i][j]; }
const listed = []; for (var i = 0; i < 16; i++) { listed.push([]); for (var j = 0; j < 16; j++) listed[i].push(i + j * 0.5); }
const loops = {
  "a nest of loops": n => { for (var r = 0, end = n | 0; r < end; r += 256) nest(listed, 16); return listed[1][1]; },
  "a callback that calls a function of a table": n => { for (var r = 0, end = n | 0; r < end; r += 256) mapped.apply(layer.der); return mapped[1][1]; },
  "products of rows": n => rows.product(n | 0),
  "in a field": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s += field.get(i & 3, (i >> 2) & 3); field.set(i & 3, 1, s * 0.5); } return s; },
  "a class that extends Array": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s += extended.get(i & 3, (i >> 2) & 3); extended.set(i & 3, 1, s * 0.5); } return s; },
  "a class that extends a mixin of Array": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s += mixed.get(i & 3, (i >> 2) & 3); mixed.set(i & 3, 1, s * 0.5); } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
