// A loop over rows whose inner loop stores numbers: functions out of a table, choices that do not change, arrays that are converted before the loop, columns that are gathered. Every kind of row gives the answers of the written loop.
let asked = 0;
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : String(value);
const table = {
  tanh: { act: Math.tanh, derivate: value => 1 - value * value },
  atan: { act: Math.atan, derivate: value => Math.cos(value) * Math.cos(value) },
  identity: { act: value => value, derivate: () => 1 },
  relu: { act: value => (value < 0 ? 0 : value), derivate: value => (value < 0 ? 0 : 1) },
  softsign: { act: value => value / (1 + Math.abs(value)), derivate: value => 1 / ((1 + Math.abs(value)) * (1 + Math.abs(value))) },
  logistic: { act: value => 1 / (1 + Math.exp(-value)), derivate: value => value * (1 - value) },
  sinc: { act: value => (value === 0 ? 1 : Math.sin(value) / value), derivate: value => Math.sqrt(value * value + 1) },
  counted: { act: value => (asked++, value * 2), derivate: value => -value },
};
class Layer {
  constructor(name) {
    var chosen = table[name];
    var act = chosen.act;
    var derivate = chosen.derivate;
    this.act = function (i, j) {
      this[i][j] = act(this[i][j]);
    };
    this.derivate = function (i, j) {
      this[i][j] = derivate(this[i][j]);
    };
  }
}
function mixin(Base) {
  if (Base === undefined) Base = Object;
  return class Rows extends Base {
    apply(callback) {
      var ii = this.rows;
      var jj = this.columns;
      for (var i = 0; i < ii; i++) {
        for (var j = 0; j < jj; j++) {
          callback.call(this, i, j);
        }
      }
      return this;
    }
    fill(value) {
      for (var i = 0; i < this.rows; i++) for (var j = 0; j < this.columns; j++) this.set(i, j, value);
      return this;
    }
    addRow(vector) {
      for (var i = 0; i < this.rows; i++) for (var j = 0; j < this.columns; j++) this[i][j] += vector[j];
      return this;
    }
    column(j, into) {
      for (var k = 0; k < this.rows; k++) into[k] = this.get(k, j);
      return into;
    }
  };
}
const mixed = mixin;
class Grid extends mixed(Array) {
  constructor(rows) {
    super(rows.length);
    for (let i = 0; i < rows.length; i++) this[i] = rows[i];
    this.rows = rows.length;
    this.columns = rows[0].length;
  }
  set(i, j, value) {
    this[i][j] = value;
    return this;
  }
  get(i, j) {
    return this[i][j];
  }
}
class Other extends mixed() {
  get(i, j) {
    return i + j;
  }
}
function sumColumns(grid) {
  var sum = [new Array(grid.columns).fill(0)];
  for (var i = 0; i < grid.rows; ++i) {
    for (var j = 0; j < grid.columns; ++j) sum[0][j] += grid[i][j];
  }
  return sum;
}
const layers = Object.keys(table).map(name => new Layer(name));
const shapes = [
  () => [[0.5, -1.5], [2.25, 0.1]],
  () => [[1, 2], [3, 4], [5, 6]],
  () => [[0.5, 1.5, -2.5], [1, 2, 3], [0.25, -0, 7.5]],
  () => [[0.5, , 2.5], [1.5, 2.5, 3.5]],
  () => [[NaN, 1.5, 2], [0.5, Infinity, -Infinity]],
  () => [Array.from({ length: 64 }, (_, i) => i * 0.25 - 4), Array.from({ length: 64 }, (_, i) => 4 - i * 0.5)],
  () => [Array.from({ length: 65 }, (_, i) => i * 0.25 - 4), Array.from({ length: 65 }, (_, i) => 4 - i * 0.5)],
  () => [[0.5, 1.5, 2.5, 3.5], [0.5], [1.5, 2.5, 3.5, 4.5]],
  () => [[0.5, 1.5], Object.freeze([2.5, 3.5]), [4.5, 5.5]],
  () => [[0.5, 1.5], new Float64Array([2.5, 3.5]), [4.5, 5.5]],
  () => [[0.5, 1.5], Object.defineProperty([2.5, 3.5], 1, { get: () => asked++, set: () => (asked += 2) }), [4.5, 5.5]],
  () => (row => [row, row, [1.5, 2.5, 0.5]])([0.5, -0.5, 1]),
  () => Array.from({ length: 9 }, (_, i) => [i * 0.5, i - 3.5, i, 0.1 * i, -i]),
];
const work = (name, f) => {
  try {
    console.log(name, show(f()), asked);
  } catch (error) {
    console.log(name, error.name, asked);
  }
};
for (const shape of shapes) {
  for (const layer of layers) {
    const grid = new Grid(shape());
    work("act", () => [...grid.apply(layer.act)]);
    work("derivate", () => [...grid.apply(layer.derivate)]);
  }
  work("fill", () => [...new Grid(shape()).fill(0.5)]);
  work("fill", () => [...new Grid(shape()).fill(3)]);
  work("fill", () => [...new Grid(shape()).fill("x")]);
  work("add", () => [...new Grid(shape()).addRow([0.5, 1.5, 2.5, 3.5, 4.5])]);
  work("add", () => (grid => [...grid.addRow(grid[0])])(new Grid(shape())));
  work("sums", () => sumColumns(new Grid(shape())));
  for (const into of [() => [], () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], () => new Array(9), () => [1, 2, 3, 4, 5, 6, 7, 8, 9], () => Object.freeze([0.5, 1.5])])
    for (const j of [0, 1, 4]) work("column", () => new Grid(shape()).column(j, into()));
  work("column", () => (grid => grid.column(1, grid[2]))(new Grid(shape())));
}
work("other", () => new Other().column(0, []));
