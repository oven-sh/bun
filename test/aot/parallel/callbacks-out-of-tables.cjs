"use strict";
// Callbacks that a method of a mixin forwards to its receiver access elements of it, and call functions that were read out of a table of records.
const log = [];
const word = x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "function" ? "function" : typeof x === "object" && x !== null ? (Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 6) }, (_, k) => k in x ? (x[k] === x ? "itself" : word(x[k])) : "hole").join() + "]" : "object") : String(x);
function say(...words) { log.push(words.map(word).join(" ")); }
function tried(title, run) { try { say(title, run()); } catch (error) { say(title, error.name); } }
globalThis.box = [0];
function hide(x) { globalThis.box[0] = x; return globalThis.box[0]; }
let shared = 2, current = null;
function logistic(value) { return 1 / (1 + Math.exp(-value)); }
function mixin(Base) {
  if (Base === undefined) Base = Object;
  return class Mixed extends Base {
    apply(callback) {
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      var rows = this.rows, columns = this.columns;
      for (var i = 0; i < rows; i++) for (var j = 0; j < columns; j++) callback.call(this, i, j);
      return this;
    }
    sum() { var total = 0; for (var i = 0; i < this.rows; i++) for (var j = 0; j < this.columns; j++) total += this.get(i, j); return total; }
  };
}
class Matrix extends mixin(Array) {
  constructor(rows, columns) { super(rows); for (var i = 0; i < rows; i++) this[i] = new Array(columns); this.rows = rows; this.columns = columns; }
  get(i, j) { return this[i][j]; }
  set(i, j, value) { this[i][j] = value; return this; }
}
class View extends mixin() {
  constructor(matrix) { super(); this.matrix = matrix; this.rows = matrix.columns; this.columns = matrix.rows; }
  get(i, j) { return this.matrix.get(j, i); }
}
const table = {
  tanh: { activation: Math.tanh, derivate: value => 1 - value * value },
  same: { activation: value => value, derivate: () => 1 },
  logistic: { activation: logistic, derivate: value => logistic(value) * (1 - logistic(value)) },
  sine: { activation: Math.sin, derivate: Math.cos },
  relu: { activation: value => value < 0 ? 0 : value, derivate: value => value < 0 ? 0 : 1 },
  minus: { activation: value => -value, derivate: value => value - value },
  text: { activation: value => "s" + value, derivate: value => [value] },
  nothing: { activation: value => undefined, derivate: value => NaN },
  stops: { activation: value => { if (value > 2) throw new RangeError("stop"); return value; }, derivate: value => { shared++; return value + shared; } },
  moves: { activation: value => { if (current && shared++ % 5 === 4) current[0] = [9, 9, 9, 9]; return value; }, derivate: value => { if (current && current[1]) current[1].length = 1; return value; } },
  two: { activation: (value, size) => value * size, derivate: (value, size) => value / size },
};
class Layer {
  constructor(options) {
    var selected = table[options.name], params = selected.activation.length;
    var activation = params > 1 ? value => selected.activation(value, options.size) : selected.activation;
    var derivate = params > 1 ? value => selected.derivate(value, options.size) : selected.derivate;
    this.activation = function (i, j) { this[i][j] = activation(this[i][j]); };
    this.derivate = function (i, j) { this[i][j] = derivate(this[i][j]); };
    if (options.start) options.start.apply(function (i, j) { this[i][j] /= Math.sqrt(options.size); });
  }
}
class Last extends Layer { constructor(options) { super(options); this.activation = function (i, j) { this[i][j] = Math.exp(this[i][j]); }; } }
function make(rows, columns, value) { const matrix = new Matrix(rows, columns); for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) matrix.set(i, j, value(i, j)); return matrix; }
const values = [(i, j) => (i * 7 + j * 3) % 11 + 0.5, (i, j) => i - j, (i, j) => i === j ? NaN : -j, (i, j) => j === 1 ? undefined : i + 0.5, (i, j) => i === 1 ? "3" : j / 4, (i, j) => 2 ** 31 - i + j];
const changes = [
  m => m, m => { m[1] = m[0]; return m; }, m => { Object.freeze(m[0]); return m; }, m => { delete m[0][1]; return m; }, m => { m[1] = new Float64Array(3); return m; }, m => { m[1] = undefined; return m; },
  m => { Object.defineProperty(m[0], 1, { get() { shared++; return 2; }, set(value) { say("set", value); }, configurable: true }); return m; }, m => { m[1] = new Proxy(m[1], {}); return m; }, m => Object.create(m), m => { m.extra = 1; return m; },
  m => new Proxy(m, {}), m => { Object.freeze(m); return m; }, m => { m[0] = [1, 2, 3]; return m; }, m => { m[0].length = 1; return m; }, m => { m.columns += 1; return m; }, m => { Object.setPrototypeOf(m, class extends Matrix { }.prototype); return m; },
];
for (let turn = 0; turn < 2; turn++) {
  for (const name of Object.keys(table)) {
    for (const value of values) {
      for (const change of changes) {
        const start = make(2, 2, value), layer = new (turn ? Last : Layer)({ name, size: 4, start });
        const matrix = hide(change(make(3, 3, value)));
        current = matrix;
        tried("activation", () => matrix.apply(layer.activation) === matrix);
        tried("derivate", () => matrix.apply(layer.derivate) === matrix);
        current = null;
        for (let row = 0; row < 3; row++) say(start[row], matrix[row]);
        tried("sum", () => matrix.sum());
      }
      tried("view", () => new View(make(2, 3, value)).apply(new Layer({ name, size: 2 }).activation));
      tried("own call", () => make(2, 2, value).apply(Object.assign(function (i, j) { this[i][j] = 5; }, { call() { shared++; } }))[0]);
    }
  }
  table.tanh.activation = value => value + 100;
}
let hash = 0;
for (const line of log) for (let k = 0; k < line.length; k++) hash = (Math.imul(hash, 31) + line.charCodeAt(k)) | 0;
console.log(log.length, hash, shared);
for (let k = 0; k < log.length; k += 97) console.log(log[k]);
