// STATISTIC: LoopsBuiltTwice >= 9
const rounds = +process.argv[2]! || 3;

class Table {
  readonly rows: number;
  readonly cols: number;
  constructor(readonly cells: number[][]) {
    this.rows = cells.length;
    this.cols = cells[0]?.length ?? 0;
  }
  static filled(rows: number, cols: number, at: (i: number, j: number) => number): Table {
    return new Table(Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_x, j) => at(i, j))));
  }
  static unit(n: number): Table { return Table.filled(n, n, (i, j) => (i === j ? 1 : 0)); }
  times(o: Table): Table {
    if (this.cols !== o.rows) throw new RangeError("the sides do not fit");
    const out: number[][] = [];
    for (let i = 0; i < this.rows; i++) {
      const row: number[] = [];
      for (let j = 0; j < o.cols; j++) {
        let s = 0;
        for (let k = 0; k < this.cols; k++) s += this.cells[i]![k]! * o.cells[k]![j]!;
        row.push(s);
      }
      out.push(row);
    }
    return new Table(out);
  }
  turned(): Table { return Table.filled(this.cols, this.rows, (i, j) => this.cells[j]![i]!); }
  each(fn: (x: number, i: number, j: number) => number): Table { return new Table(this.cells.map((row, i) => row.map((x, j) => fn(x, i, j)))); }
  raised(k: number, modulus: number): Table {
    let result = Table.unit(this.rows), base: Table = this;
    for (let e = k; e > 0; e >>= 1) {
      if (e & 1) result = result.times(base).each(x => x % modulus);
      base = base.times(base).each(x => x % modulus);
    }
    return result;
  }
  sum(): number { return this.cells.flat().reduce((s, x) => s + x, 0); }
}

let all = 0;
for (let r = 0; r < rounds; r++) {
  const a = Table.filled(8, 8, (i, j) => ((i * 7 + j * 3 + r) % 11) - 4 + (i === j ? 9.5 : 0)), b = a.turned();
  all += a.times(b).sum();
  all += new Table([[1, 1], [1, 0]]).raised(60 + (r % 7), 9973).cells[0]![1]!;
  try { a.times(new Table([[1, 2]])); } catch (e) { all += (e as Error).message.length; }
}
console.log(all);
