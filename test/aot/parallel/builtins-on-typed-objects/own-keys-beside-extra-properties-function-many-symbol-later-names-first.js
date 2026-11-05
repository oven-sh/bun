const names = JSON.parse('["extra", "more", "last", "4"]');
function Row() { this.id = 1; this.label = "a"; }
const make = () => new Row;
const show = list => list.map(String).join(",");
function list(row) {
  const lines = [];
  lines.push(show(Object.getOwnPropertyNames(row)));
  lines.push(show(Object.getOwnPropertySymbols(row)));
  lines.push(show(Reflect.ownKeys(row)));
  lines.push(show(Object.keys(row)));
  const inLoop = []; for (const key in row) inLoop.push(key);
  lines.push(inLoop.join(","), JSON.stringify(row), show(Object.entries(row)));
  return lines.join(" | ");
}
const rows = [make(), make(), make()];
for (const row of rows) { for (let i = 0; i < 70; i++) row[names[0] + i] = i; }
for (let round = 0; round < 3; round++) for (const row of rows) console.log(round, list(row));
{ const row = rows[1]; try { row[Symbol.for("later")] = 1; } catch (error) { console.log(error.constructor.name); } }
for (let round = 0; round < 3; round++) for (const row of rows) console.log(round, list(row));
