// The arrays and the numbers of columns are fields that each iteration reads, and positions are numbers that are integers.
// STATISTIC: ViewSumNests >= 2
class Matrix {
  constructor(rows, columns) {
    this.rows = rows;
    this.columns = columns;
    this.data = [];
    for (let index = 0; index < rows * columns; index++) this.data.push(0.5);
  }
  multiply(other) {
    const result = new Matrix(this.rows, other.columns);
    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < other.columns; column++) {
        let sum = 0;
        for (let term = 0; term < this.columns; term++) sum += this.data[row * this.columns + term] * other.data[term * other.columns + column];
        result.data[row * other.columns + column] = sum;
      }
    }
    return result;
  }
  local(other) {
    const result = new Matrix(this.rows, other.columns);
    const a = this.data, b = other.data, c = result.data, m = other.columns, n = this.columns;
    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < m; column++) {
        let sum = 0;
        for (let term = 0; term < n; term++) sum += a[row * n + term] * b[term * m + column];
        c[row * m + column] = sum;
      }
    }
    return result;
  }
}
let seed = 5;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function make(rows, columns) {
  const result = new Matrix(rows, columns);
  for (let index = 0; index < rows * columns; index++) result.data[index] = (next() % 2000 - 1000) / 64 + 0.125;
  return result;
}
function show(array) {
  let hash = 7, nothing = 0;
  for (let index = 0; index < array.length; index++) {
    const value = array[index];
    if (value !== value) nothing++;
    else hash = Math.imul(hash ^ (value * 4096), 16777619) >>> 0;
  }
  return array.length + ":" + nothing + ":" + hash;
}
const lines = [];
function run(a, b) {
  lines.push(show(a.multiply(b).data), show(a.local(b).data));
}
for (const [rows, terms, columns] of [[12, 12, 12], [3, 20, 9], [20, 9, 4], [5, 8, 33], [1, 64, 64]]) run(make(rows, terms), make(terms, columns));
const short = make(12, 12);
short.data.length = 140;
run(short, make(12, 12));
run(make(12, 12), short);
const wide = make(12, 12);
wide.columns = 13;
run(wide, make(13, 12));
run(make(12, 12), wide);
const nothing = make(9, 9);
nothing.data[40] = NaN;
run(nothing, make(9, 9));
delete nothing.data[41];
run(nothing, make(9, 9));
run(nothing, nothing);
console.log(lines.join("\n"));
