// `this.rows.map(..)` in one method, `this.rows[i]` in the loop of another: elements are read under keys, which fits a list and a view alike: a list, bytes and floats come.
class Store { constructor(rows) { this.rows = rows; } more() { return this.rows.map(x => x + 1).length; } greatest(t) { let m = -Infinity; for (let i = 0; i < this.rows.length; i++) if (this.rows[i] > m) m = this.rows[i]; return m + (t & 1); } }
const given = JSON.parse("[3, 1, 4, 1, 5]");
for (const rows of [given, new Uint8Array(given), new Float64Array(given)]) {
  const store = new Store(rows);
  for (let t = 0; t < 2; t++) console.log(store.greatest(t), store.more());
}
