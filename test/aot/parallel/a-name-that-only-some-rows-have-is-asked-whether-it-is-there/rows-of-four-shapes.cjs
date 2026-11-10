const rows = [];
for (let at = 0; at < 32; at++) {
  if (at % 4 === 0) rows.push({ id: at, price: at * 1.25, quantity: at + 1 });
  else if (at % 4 === 1) rows.push({ id: at, price: at * 1.25, quantity: at + 1, note: "n" });
  else if (at % 4 === 2) rows.push({ id: at, price: at * 1.25, quantity: at + 1, discount: 2 });
  else rows.push({ id: at, price: at * 1.25, quantity: at + 1, note: "", discount: 0 });
}
function work(list, turn) {
  let total = 0;
  for (const row of list) total += row.price * row.quantity - (row.discount ?? 7) + (row.note ? 1 : 0) + row.id;
  return (total + turn) | 0;
}
let sum = 0;
for (let turn = 0; turn < 3000; turn++) sum = (sum * 31 + work(rows, turn)) | 0;
console.log(sum);
