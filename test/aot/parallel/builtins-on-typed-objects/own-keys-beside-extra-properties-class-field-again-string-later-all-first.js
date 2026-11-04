const names = JSON.parse('["extra", "more", "last", "4"]');
class Row { id = 1; label = "a"; note; }
const make = () => new Row;
const show = list => list.map(String).join(",");
function list(row) {
  const lines = [];
  lines.push(show(Reflect.ownKeys(row)));
  lines.push(show(Object.getOwnPropertyNames(row)));
  lines.push(show(Object.keys(row)));
  lines.push(show(Object.getOwnPropertySymbols(row)));
  const inLoop = []; for (const key in row) inLoop.push(key);
  lines.push(inLoop.join(","), JSON.stringify(row), show(Object.entries(row)));
  return lines.join(" | ");
}
const rows = [make(), make(), make()];
for (const row of rows) { row[names[0]] = 1; delete row.id; row.id = 9; row[names[1]] = 2; }
for (let round = 0; round < 3; round++) for (const row of rows) console.log(round, list(row));
{ const row = rows[1]; try { row[names[2]] = 3; } catch (error) { console.log(error.constructor.name); } }
for (let round = 0; round < 3; round++) for (const row of rows) console.log(round, list(row));
