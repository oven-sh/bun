const rows = [{ id: 1, qty: 2.5 }, { id: 2, qty: 0.25 }, { id: 3 }];
const config = JSON.parse('{"items":[1,2]}');
const full = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3, qty: 7 }];
function count(rows, config) {
  let total = 0, missing = 0;
  const others = Array.from(config.items);
  total += others.length;
  const list = rows.map((row) => row.qty).slice();
  try {
    for (let i = 0; i + 1 < list.length; i++) total += (list[i] ?? 1) + (list[i + 1] ?? 1);
    try { total += 0; } catch { total = -1; }
    for (let i = 0; i < list.length; i++) switch (list[i]) { case undefined: missing++; }
  } finally { total += 0; }
  return total + " " + missing;
}
for (const given of [full, full, rows, full, rows]) console.log(count(given, config));
