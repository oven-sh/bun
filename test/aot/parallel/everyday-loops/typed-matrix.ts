// A matrix of a class with fields, filled, transposed and summed
class Matrix {
  readonly rows: number[][] = [];
  constructor(public height: number, public width: number, start: number) {
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) row.push(start + y * width + x);
      this.rows.push(row);
    }
  }
  transposed(): Matrix {
    const out = new Matrix(this.width, this.height, 0);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) out.rows[x][y] = this.rows[y][x];
    return out;
  }
  sum = (): number => this.rows.reduce((total, row) => total + row.reduce((a, b) => a + b, 0), 0);
}
console.log(JSON.stringify(new Matrix(2, 3, 1).transposed().rows), new Matrix(2, 3, 1).sum());
console.log(JSON.stringify(new Matrix(3, 1, 0.5).transposed()));
console.log(new Matrix(0, 2, 0).transposed().rows.length, new Matrix(4, 4, 2147483640).sum());
