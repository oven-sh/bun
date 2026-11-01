const rows = [{ id: 1, qty: 2 }, { id: 2, qty: 0 }, { id: 3 }];
const config = JSON.parse('{"items":[1,2]}');
function count(rows, config) {
  let total = 0, missing = 0;
  const byItem = new Map(config.items.map((item) => [item, item]));
  for (const value of byItem.values()) total += value;
  const list = [...rows.map((row) => row.qty)];
  for (let i = 0; i < list.length; i++) total += list[i] ?? 1;
  for (let i = 0; i < list.length; i++) if (typeof list[i] === "undefined") missing++;
  return total + " " + missing;
}
for (let turn = 0; turn < 3; turn++) console.log(count(rows, config));
