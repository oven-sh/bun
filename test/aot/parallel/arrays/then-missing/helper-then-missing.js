const rows = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3 }];
const config = JSON.parse('{"items":[1,2]}');
function quantities(rows) { return rows.map((row) => row.qty); }
function count(rows, config) {
  let total = 0, missing = 0;
  for (const item of config.items) total += item;
  const list = quantities(rows);
  for (let i = 0; i < list.length; i++) total += list[i] ?? 1;
  for (let i = 0; i < list.length; i++) missing += list[i] === undefined ? 1 : 0;
  return total + " " + missing;
}
for (let turn = 0; turn < 3; turn++) console.log(count(rows, config));
