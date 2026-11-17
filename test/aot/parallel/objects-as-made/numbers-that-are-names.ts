function fill(rows: number[], count: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  for (let k = 0; k < count; k++) rows[k * 0.75] = k;
  for (let k = 0; k < 3; k++) rows.push(k + work);
  return rows.length;
}
const count = Number(JSON.parse("5"));
const rows: number[] = [];
console.log(fill(rows, count), rows.indexOf(2), rows[1.5], Object.keys(rows).join());
const others: number[] = [];
for (let k = 1; k < 3; k++) others[k * 4294967295] = k;
console.log(fill(others, 1), Object.keys(others).length);
