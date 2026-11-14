// Loops that allocate an array of a given length in each iteration and store it at the counter: lengths of every kind, arrays that are too short or hold other kinds, subclasses, many rows, and sites whose arrays come to hold
// ints, doubles and other values.
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.length + (value.length ? ":" + [0, 1, value.length >> 1, value.length - 1].map(i => (i in value ? show(value[i]) : "hole")).join() : "") + "]" : String(value));
function mixin(Base) {
  class Rows extends Base {}
  return Rows;
}
class Table extends mixin(Array) {
  constructor(m, n) {
    super(m);
    for (var i = 0; i < m; i++) this[i] = new Array(n);
    this.rows = m;
    this.columns = n;
  }
}
class Other extends Array {
  constructor(m, n) {
    super(m);
    for (let i = 0; i < m; i++) {
      this[i] = new Array(n);
    }
  }
}
class Longer extends mixin(Array) {
  constructor(m, n, k) {
    super(m);
    for (var i = 0; i < m + k; i++) this[i] = new Array(n);
    this.rows = m;
  }
}
class Late extends mixin(Array) {
  constructor(m, n, k) {
    super(m);
    this.length = k;
    for (var i = 0; i < m; i++) this[i] = new Array(n);
  }
}
function made(m, n) {
  const a = new Array(m);
  for (let i = 0; i < m; i++) a[i] = new Array(n);
  return a;
}
function grown(m, n) {
  const a = [];
  for (let i = 0; i < m; i++) a[i] = new Array(n);
  return a;
}
function put(a, first, m, n) {
  for (let i = first; i < m; i++) a[i] = new Array(n);
  return a;
}
function fill(a, f) {
  for (let i = 0; i < a.length; i++) {
    const row = a[i];
    if (row) for (let j = 0; j < row.length; j++) row[j] = f(i, j);
  }
  return a;
}
const lengths = [1, 2, 3, 4, 5, 16, 17, 18, 20, 33, 126, 127, 128, 200, 0, -1, 1.5, "3", undefined, null, NaN, 2 ** 32, -0];
const values = [(i, j) => i + j, (i, j) => i + j + 0.5, (i, j) => "x" + i, (i, j) => ((i + j) % 3 ? i : 0.25), (i, j) => undefined, (i, j) => NaN];
let text = "";
let hash = 0;
function add(f) {
  let shown;
  try {
    shown = show(f());
  } catch (error) {
    shown = error.name;
  }
  for (let k = 0; k < shown.length; k++) hash = (hash * 31 + shown.charCodeAt(k)) | 0;
}
for (const m of [0, 1, 2, 3, 4, 16, 64, 300]) {
  for (const n of lengths) {
    for (const make of [() => new Table(m, n), () => new Other(m, n), () => new Longer(m, n, 3), () => new Late(m, n, 2), () => made(m, n), () => grown(m, n), () => put([1, 2, 3], 0, m, n), () => put([0.5], 0, m, n), () => put(new Array(40), 1, m, n), () => put([{}, {}, {}], 2, m, n), () => put(Object.freeze([{}, {}]), 0, m, n), () => put({}, 0, m, n)]) {
      add(make);
      if (m < 64) for (const value of values) add(() => fill(make(), value));
    }
  }
  console.log(m, hash);
}
const kept = [];
for (let k = 0; k < 400; k++) {
  kept.push(fill(new Table(1 + (k % 7), 2 + (k % 20)), values[k % 2]));
  if (k % 50 === 49) globalThis.gc?.();
}
let sum = 0;
for (const table of kept) for (const row of table) for (const element of row) sum += element;
console.log(sum, kept.map(table => table.rows * table.columns).join());
console.log(made(20000, 3).length, made(20000, 3).every(row => row.length === 3 && !(0 in row)));
