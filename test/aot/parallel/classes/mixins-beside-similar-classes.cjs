// The parent of a mixin is what the calls in extends clauses pass, whichever class of the program has the fields that its text speaks of.
// STATISTIC: RowHoldersOfSubclasses >= 1
// STATISTIC: BuiltinSubclassesCheckedByStructure >= 10
let mixinOfMatrices;
{
  mixinOfMatrices = function mixinOfMatrices(Super) {
    if (Super === undefined) Super = Object;
    class Operations extends Super {
      times(other) {
        let sum = 0;
        for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) sum += this.get(i, j) * other.get(i, j);
        return sum;
      }
      add(value) {
        for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + value);
        return this;
      }
    }
    return Operations;
  };
}
class Screen {
  constructor() {
    this.rows = 25;
    this.columns = 80;
  }
}
let Transposed;
{
  const mixin = mixinOfMatrices;
  class View extends mixin() {
    constructor(matrix, rows, columns) {
      super();
      this.matrix = matrix;
      this.rows = rows;
      this.columns = columns;
    }
  }
  Transposed = class Transposed extends View {
    constructor(matrix) {
      super(matrix, matrix.columns, matrix.rows);
    }
    get(i, j) { return this.matrix.get(j, i); }
    set(i, j, value) { this.matrix.set(j, i, value); return this; }
  };
}
let Matrix;
{
  const mixin = mixinOfMatrices;
  Matrix = class Matrix extends mixin(Array) {
    constructor(rows, columns) {
      super(rows);
      for (let i = 0; i < rows; i++) this[i] = new Array(columns);
      this.rows = rows;
      this.columns = columns;
    }
    get(i, j) { return this[i][j]; }
    set(i, j, value) { this[i][j] = value; return this; }
  };
}
const out = [];
for (const [rows, columns] of [[4, 5], [1, 1], [7, 2]]) {
  const a = new Matrix(rows, columns), b = new Matrix(rows, columns);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      a.set(i, j, i + j * 0.5);
      b.set(i, j, i * j);
    }
  }
  out.push(a.times(b), new Transposed(a).times(new Transposed(b)), a.add(0.25).times(b), new Transposed(b).add(1).get(0, 0), JSON.stringify(a), JSON.stringify(b));
  out.push(Object.keys(a).join(), a instanceof Array, new Transposed(a) instanceof Array, a.length);
}
const screen = new Screen();
out.push(screen.rows * screen.columns, JSON.stringify(screen));
const odd = new Matrix(2, 2);
odd[1] = { 0: "a", 1: 2 };
odd.set(0, 0, 1).set(0, 1, 2);
out.push(odd.add("x").get(1, 0), odd.get(0, 1));
Object.defineProperty(odd, "rows", { get() { return 1; } });
out.push(odd.times(odd));
for (const line of out) console.log(String(line));
