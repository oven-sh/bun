const rows = [{ id: 1 }, { id: 2, qty: 0 }, { id: 3, qty: 5 }];
const config = JSON.parse('{"items":[1,2]}');
const full = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3, qty: 7 }];
function count(rows, config) {
  let total = 0, missing = 0;
  const others = config.items.map((item) => item + 1);
  for (let i = 0; i < others.length; i++) total += others[i];
  const list = rows.map((row) => row.qty);
  try {
    for (let i = 0; i < list.length; i++) { const value = list[i]; if (value !== undefined) total += value; }
    for (let i = 0; i < list.length; i++) if (list[i] === undefined) missing++;
  } finally { total += 0; }
  return total + " " + missing;
}
for (const given of [full, full, rows, full, rows]) console.log(count(given, config));
