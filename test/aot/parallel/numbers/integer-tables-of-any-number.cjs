// Tables whose values turn out to be fractions, NaN, -0, too large, missing or no numbers at all.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v));
function fill(table, steps, gains, op) {
  for (let i = 1; i < table.length; i++) {
    for (let c = 0; c < table[i].length; c++) {
      table[i][c] = table[i - 1][c];
      if (c >= steps[i - 1]) table[i][c] = op ? Math.max(table[i][c], table[i - 1][c - steps[i - 1]] + gains[i - 1]) : Math.min(table[i][c] * 2, table[i - 1][c] - gains[i - 1]);
    }
  }
  return table;
}
const makers = [
  () => Array.from({ length: 4 }, () => new Array(6).fill(0)),
  () => [[1, 2, 3], [0, 0, 0], [0, 0, 0]],
  () => [[0.5, 1, 2], [0, 0, 0], [0, 0, 0]],
  () => [[-0, 0, 1], [0, 0, 0], [0, 0, 0]],
  () => [[2147483647, 1, 2147483646], [0, 0, 0], [0, 0, 0]],
  () => [[1, , 3], [0, 0, 0], [0, , 0]],
  () => [["a", 1, 2], [0, 0, 0], [0, 0, 0]],
  () => [[1, 2, 3], [0.5, 0, 0], ["x", 0, 0]],
  () => [[1n, 2n, 3n], [0, 0, 0], [0, 0, 0]],
  () => [[1, 2, 3], Object.freeze([0, 0, 0]), [0, 0, 0]],
  () => [new Int32Array([1, 2, 3]), new Float64Array(3), [0, 0, 0]],
  () => [[1, 2, 3], Object.defineProperty([0, 0, 0], 1, { set(v) { this.seen = v; }, get() { return 9; } }), [0, 0, 0]],
  () => { const row = [1, 2, 3]; return [row, row, row]; },
];
const gainLists = [[1, 2, 3], [1.5, 2, 3], [NaN, 1, 2], [2147483647, 2147483647, 1], [-0, -0, -0], [undefined, 1, 2], ["q", 1, 2], [1e300, 1, 1]];
for (const make of makers) {
  for (const gains of gainLists) {
    for (const op of [true, false]) {
      let out;
      try {
        out = fill(make(), [0, 1, 2], gains, op).map(row => Array.from(row, show).join()).join(" ");
      } catch (e) {
        out = e.constructor.name;
      }
      console.log(out);
    }
  }
}
