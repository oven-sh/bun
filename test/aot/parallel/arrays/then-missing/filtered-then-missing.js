const rows = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3 }];
const config = JSON.parse('{"items":[1,2]}');
function count(rows, config) {
  let total = 0, missing = 0;
  const others = config.items.map((item) => item + 1);
  for (let i = 0; i < others.length; i++) total += others[i];
  const list = rows.map((row) => row.qty).filter(() => true);
  { let i = 0; while (i < list.length) { total += list[i] ?? 1; i++; } }
  for (const value of list) if (value === undefined) missing++;
  return total + " " + missing;
}
for (let turn = 0; turn < 3; turn++) console.log(count(rows, config));
