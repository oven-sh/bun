// An inner loop has a version for int32s and one for doubles. The turn before says which of them is tried first: every order of rows gives the same answers.
let asked = 0;
class Grid extends Array {
  constructor(rows, columns, kind) {
    super(rows);
    this.rows = rows;
    this.columns = columns;
    for (let i = 0; i < rows; i++) this[i] = kind === 0 ? new Array(columns) : new Array(columns).fill(kind);
  }
  get(row, column) {
    return this[row][column];
  }
  set(row, column, value) {
    this[row][column] = value;
    return this;
  }
  clone() {
    const made = new this.constructor(this.rows, this.columns, 0);
    for (let row = 0; row < this.rows; row++)
      for (let column = 0; column < this.columns; column++) made.set(row, column, this.get(row, column));
    return made;
  }
  add(other) {
    for (let row = 0; row < this.rows; row++)
      for (let column = 0; column < this.columns; column++) this.set(row, column, this.get(row, column) + other.get(row, column));
    return this;
  }
  scale(factor) {
    for (let row = 0; row < this.rows; row++)
      for (let column = 0; column < this.columns; column++) this.set(row, column, this.get(row, column) * factor);
    return this;
  }
}
/**
 * @param {number[][]} from
 * @param {number[][]} to
 * @param {number} rows
 * @param {number} columns
 */
function copy(from, to, rows, columns) {
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      to[row][column] = from[row][column];
      sum += to[row][column];
    }
  }
  return sum;
}
globalThis.copy = copy;
const rowOf = {
  i: n => Array.from({ length: n }, (_, k) => k - 1),
  d: n => Array.from({ length: n }, (_, k) => k + 0.5),
  z: n => new Array(n).fill(0),
  h: n => new Array(n),
  o: n => Array.from({ length: n }, (_, k) => (k === 1 ? "1" : k)),
  g: n => Object.defineProperty(Array.from({ length: n }, (_, k) => k * 2), 0, { get() { return asked++; }, set(value) { asked += 2; }, configurable: true }),
  s: n => Array.from({ length: n - 1 }, (_, k) => k * 0.25),
  f: n => new Float64Array(n).fill(1.5),
};
const orders = ["iiii", "dddd", "idid", "didi", "ddii", "iidd", "zdzd", "dhdh", "ddod", "dgdd", "idsd", "dfdi", "ziid", "oooo", "dioz"];
for (const from of orders) {
  for (const to of orders) {
    const make = order => [...order].map(kind => rowOf[kind](3));
    const a = make(from), b = make(to);
    asked = 0;
    try {
      console.log(from, to, String(globalThis.copy(a, b, 4, 3)), JSON.stringify(b), asked);
    } catch (error) {
      console.log(from, to, error.name, JSON.stringify(b), asked);
    }
  }
  const grid = new Grid(4, 3, 0);
  [...from].forEach((kind, row) => { grid[row] = rowOf[kind](3); });
  const other = new Grid(4, 3, 0.5);
  try {
    console.log(JSON.stringify([...grid.clone().add(other).scale(2)]), JSON.stringify([...other.add(grid).clone().scale(0.5).add(grid)]), asked);
  } catch (error) {
    console.log(error.name, asked);
  }
}
