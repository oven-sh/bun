const rows = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3 }];
const config = JSON.parse('{"items":[1,2]}');
const full = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3, qty: 7 }];
function count(rows, config) {
  let total = 0, missing = 0;
  const others = config.items.map((item) => item + 1);
  for (let i = 0; i < others.length; i++) total += others[i];
  const list = [rows[0].qty, rows[1].qty, rows[2].qty];
  if (config.items.length > 0) {
    for (let i = 0; i < list.length; i++) total += list[i] ?? 1;
    for (let i = 0; i < list.length; i++) missing += typeof list[i] === "number" ? 0 : 1;
  }
  return total + " " + missing;
}
for (const given of [rows, full, rows]) console.log(count(given, config));
