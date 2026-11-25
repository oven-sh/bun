"use strict";
const text = "[" + Array.from({ length: 12 }, (_, i) => '{"town":"' + ["north", "south", "west"][i % 3] + '","open":' + (i % 4 !== 0) + ',"points":' + (i * 1.5 + 0.25) + "}").join() + "]";
const rows = JSON.parse(text);
function add(group, row) { group.n += 1; if (row.open) group.open += 1; group.sum += row.points; return group; }
function report(least) {
  const groups = rows.filter(row => row.points >= least).reduce((all, row) => { all[row.town] = add(all[row.town] ?? { town: row.town, n: 0, open: 0, sum: 0 }, row); return all; }, {});
  return Object.values(groups).sort((a, b) => b.sum - a.sum);
}
let out = 0;
for (let turn = 0; turn < 40; turn++) { const made = report(turn & 7); out += made.length + made[0].n + made[0].open; }
console.log(out, JSON.stringify(report(9)));
