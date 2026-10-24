// Rows of parsed data are copied onto fresh literal objects in three kinds of loops. Another function stores one of the names directly on objects of the same layout.
const rows = JSON.parse('[{"late": 1, "x": "a"}, {"late": "s"}, {"y": null, "late": [1]}, {}, {"late": {"n": 1}, "extra": true}]');
function record(i) {
  return { x: i, y: i + 1 };
}
function fromRow(row, i) {
  const target = record(i);
  for (const k of Object.keys(row)) target[k] = row[k];
  return target;
}
function fromRowIn(row, i) {
  const target = record(i);
  for (const k in row) target[k] = row[k];
  return target;
}
function fromEntries(row, i) {
  const target = record(i);
  for (const [k, v] of Object.entries(row)) target[k] = v;
  return target;
}
function named(i) {
  const target = record(i);
  target.late = "named " + i;
  return target;
}
function describe(o) {
  return typeof o.late + "/" + typeof o.x + "/" + typeof o.y + "/" + JSON.stringify(o);
}
const all = [];
rows.forEach((row, i) => all.push(fromRow(row, i), fromRowIn(row, i), fromEntries(row, i), named(i)));
console.log(all.map(describe).join("\n"));
let total = 0;
for (let round = 0; round < 500; round++) for (const o of all) total += typeof o.late === "string" ? o.late.length : 1;
console.log(total);
