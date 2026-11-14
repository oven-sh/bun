// Beside `this.rows.map(..)` the field is handed to a function, laid into a variable and iterated: what is done with it there is not seen at the field: bytes and a list come.
function last(rows) { return rows[rows.length - 1]; }
class Store { constructor(rows) { this.rows = rows; } run() { const rows = this.rows; let sum = rows[0]; for (const x of this.rows) sum += x; return sum + last(this.rows) + this.rows.map(x => x + 1).length; } }
const given = JSON.parse("[3, 1, 4, 1, 5]");
for (const rows of [given, new Uint8Array(given)]) console.log(new Store(rows).run());
