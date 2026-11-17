// A matrix over one list, with rows as getters and an iterator
class Matrix {
  constructor(width, cells) {
    this.width = width;
    this.cells = cells;
  }
  get height() {
    return this.cells.length / this.width;
  }
  at(x, y) {
    return this.cells[y * this.width + x];
  }
  *rows() {
    for (let y = 0; y < this.height; y++) yield this.cells.slice(y * this.width, (y + 1) * this.width);
  }
  determinant() {
    if (this.width === 1) return this.cells[0];
    let sum = 0;
    for (let x = 0; x < this.width; x++) sum += (x % 2 ? -1 : 1) * this.at(x, 0) * this.minor(x).determinant();
    return sum;
  }
  minor(skip) {
    return new Matrix(this.width - 1, this.cells.filter((_, i) => i >= this.width && i % this.width !== skip));
  }
}
for (const cells of [[1, 2, 3, 4], [2, 0, 1, 1, 3, 2, 1, 1, 4], [5]]) {
  const matrix = new Matrix(Math.sqrt(cells.length), cells);
  console.log(matrix.determinant(), [...matrix.rows()].map(row => row.join()).join("/"), matrix.height);
}
