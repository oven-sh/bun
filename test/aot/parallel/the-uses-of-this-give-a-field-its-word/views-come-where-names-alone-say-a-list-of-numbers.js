// The uses of `this.rows` call methods alone and say: a list of numbers. Floats, bytes, a buffer, a list with a hole, a list of texts, a record with its own map and nothing at all come instead: each answers as plain Bun does.
class Store { constructor(rows) { this.rows = rows; } run(t) { const more = this.rows.map(x => x + 1); return [more[t % 3], more.length, this.rows.indexOf(t), this.rows.reduce((sum, x) => sum + x * 2, 0)].join(); } }
const given = JSON.parse("[3, 1, 4]");
const own = { length: 2, map: f => [f(7), f(8)], indexOf: t => -t, reduce: (f, start) => f(start, 9) };
for (const rows of [new Float64Array(given), new Uint8Array(given), Buffer.from(given), [1, , 3], ["a", "b", "c"], own, null, undefined]) {
  const store = new Store(rows);
  for (let t = 0; t < 2; t++) { try { console.log(store.run(t)); } catch (error) { console.log(error instanceof TypeError); } }
}
