const lists = [0, 1, 2].map(() => ["", ""]);
const holder = new (class {
  constructor(rows) {
    this.rows = rows;
  }
})(lists);
const copy = structuredClone(holder);
const out = copy.rows;
out[0][0] = "x";
console.log(`${out.length} ${String(out[0][0])} ${String(out[1] && out[1][0])} ${String(out[2] && out[2][0])} ${out[0] === out[1]} ${String(lists[0][0])}`);
