const rows = [{ id: 1 }, { id: 2, qty: 0 }, { id: 3, qty: 5 }];
const config = JSON.parse('{"items":[1,2]}');
function count(rows, config) {
  let total = 0, missing = 0;
  const others = config.items.map((item) => item + 1);
  for (let i = 0; i < others.length; i++) total += others[i];
  const list = config.items.length > 1 ? rows.map((row) => row.qty) : rows.map((row) => row.id);
  if (config.items.length > 0) {
    for (let i = 0; i < list.length; i++) { const value = list[i]; if (value !== undefined) total += value; }
    if (total > 1000) total = 0;
    for (let i = list.length - 1; i >= 0; i--) if (list[i] == null) missing++;
  }
  return total + " " + missing;
}
for (let turn = 0; turn < 3; turn++) console.log(count(rows, config));
