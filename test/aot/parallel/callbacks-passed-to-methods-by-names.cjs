// Methods of receivers that nothing is known of call what they are handed, in loops. Few closures are handed to most of them, and others arrive, too.
const log = [];
const word = x => Object.is(x, -0) ? "-0" : typeof x === "function" ? "function" : typeof x === "object" && x !== null ? (Array.isArray(x) ? "[" + Array.from(x, word).join() + "]" : "object") : String(x);
function say(...words) { log.push(words.map(word).join(" ")); }
function tried(title, run) { try { say(title, run()); } catch (error) { say(title, error.name); } }
const keys = new Map("apply each fold rows columns".split(" ").map(key => [key, key]));
function lay(holder, key, value) { Reflect.defineProperty(holder, keys.get(key), { value, writable: true, configurable: true }); }
function mixin(Base) {
  if (Base === undefined) Base = Object;
  return class Mixed extends Base {
    apply(callback) {
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) callback.call(this, i, j);
      return this;
    }
    each(callback, other) { let sum = 0; for (let i = 0; i < this.rows; i++) sum += callback(i, this) + (other ? other(i) : 0); return sum; }
    fold(callback, start) { let value = start; for (let i = 0; i < this.rows; i++) value = callback.apply(this, [value, i]); return value; }
  };
}
class Matrix extends mixin(Array) {
  constructor(rows, columns, value) { super(rows); for (let i = 0; i < rows; i++) { this[i] = []; for (let j = 0; j < columns; j++) this[i][j] = value(i, j); } this.rows = rows; this.columns = columns; }
}
class View extends mixin() { constructor(matrix) { super(); this.matrix = matrix; this.rows = matrix.rows; this.columns = matrix.columns; for (let i = 0; i < this.rows; i++) this[i] = matrix[i]; } }
const table = { half: { run: value => value / 2, back: value => value * 2 }, text: { run: value => value + "x", back: () => undefined } };
class Layer {
  constructor(name) {
    const { run, back } = table[name];
    this.run = function (i, j) { this[i][j] = run(this[i][j]); };
    this.back = function (i, j) { this[i][j] = back(this[i][j]); };
  }
}
class Other extends Layer { constructor(name) { super(name); this.run = function (i, j) { this[i][j] = [i, j].join("-"); }; } }
const values = [(i, j) => i + j, (i, j) => i / 2 - j, (i, j) => (i + j) & 1 ? i : 0.5, (i, j) => j ? "s" : i, () => undefined];
function rows(matrix) { const found = []; for (let i = 0; i < matrix.rows; i++) found.push(word(matrix[i])); return found.join(); }
for (let turn = 0; turn < 3; turn++) {
  for (const value of values) {
    for (const make of [() => new Matrix(3, 2, value), () => new View(new Matrix(2, 3, value)), () => Object.assign(new Matrix(2, 2, value), { extra: 1 })]) {
      for (const layer of [new Layer("half"), new Layer("text"), new Other("half")]) {
        const matrix = make();
        tried("run", () => rows(matrix.apply(layer.run)));
        tried("back", () => rows(matrix.apply(layer.back)));
        tried("each", () => matrix.each((i, object) => object.rows * i, i => i));
        tried("each", () => matrix.each(i => { if (i === 1) lay(matrix, "rows", 2); return i; }));
        tried("fold", () => matrix.fold(function (value, i) { return value + this.columns * i; }, 0.5));
        tried("fold", () => matrix.fold((value, i) => value + i, "t"));
      }
    }
  }
  const matrix = new Matrix(2, 2, (i, j) => i - j), layer = new Layer("half");
  for (const callback of [Math.max, layer.run.bind(new Matrix(2, 2, () => 7)), undefined, "text", {}, class { }, new Proxy(layer.run, {}), function* () { }, async function () { }, Array, eval, () => { throw new RangeError("no"); }]) {
    tried("other", () => rows(matrix.apply(callback)));
    tried("other", () => matrix.each(callback));
    tried("other", () => matrix.fold(callback, 1));
  }
  tried("within", () => rows(matrix.apply(function (i, j) { if (i === 0 && j === 0) { layer.run = layer.back; matrix.apply(layer.run); } this[i][j]++; })));
  tried("own", () => { const run = layer.back; run.call = function (object, i, j) { object[i][j] = "own"; }; return rows(matrix.apply(run)); });
  tried("no prototype", () => { const run = new Layer("half").run; Reflect.setPrototypeOf(run, null); return rows(new Matrix(1, 1, () => 1).apply(run)); });
  tried("shrinks", () => { const wide = new Matrix(3, 3, () => 1); wide.apply(function (i, j) { this[i][j] = j; if (i === 1) lay(this, "columns", 1); }); return rows(wide); });
  tried("no row", () => { const short = new Matrix(3, 1, () => 1); short.apply(function (i) { this.length = 1; return this[i][0]; }); return rows(short); });
  tried("strangers", () => { const object = { rows: 2, columns: 1, 0: [4], 1: [6] }; matrix.apply.call(object, new Layer("half").run); return word(object[0]) + word(object[1]); });
}
lay(Matrix.prototype, "apply", function (callback) { return callback.call(this, 0, 0), this; });
tried("replaced", () => rows(new Matrix(2, 2, () => 8).apply(new Layer("half").run)));
console.log(log.join("\n"));
