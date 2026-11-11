// `this.rows.map(..)`, `.indexOf(..)`, `.reduce(..)`, `.length`: names alone are read off the field, and they say: a list of numbers. The list comes out of a text.
class Store { constructor(rows) { this.rows = rows; } run(t) { const more = this.rows.map(x => x + 1); return more[t % 5] + more.length + this.rows.indexOf(t) + this.rows.reduce((sum, x) => sum + x * 2, 0); } }
const store = new Store(JSON.parse("[3, 1, 4, 1, 5]"));
const rounds = JSON.parse("4");
for (let t = 0; t < rounds; t++) console.log(store.run(t));
