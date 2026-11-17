const rows = JSON.parse(JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ region: ["n", "s", "e"][i % 3], kind: ["alpha", "beta", "gamma", "delta"][i % 4], month: i % 7, amount: i * 1.5 }))));
const groupBy = (list, name) => list.reduce((groups, row) => { const key = name(row); (groups[key] = groups[key] || []).push(row); return groups; }, {});
function byTexts() { return groupBy(rows, row => row.region + ":" + row.kind); }
function byTextAndNumber() { const sums = {}; for (const row of rows) { const key = row.region + ":" + row.month; sums[key] ??= 0; sums[key] += row.amount; } return sums; }
function textOnLeft() { const counts = {}; for (const row of rows) { const key = "at-" + row.month; counts[key] = (counts[key] ?? 0) + 1; } return counts; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all += Object.keys(byTexts()).length + Object.keys(byTextAndNumber()).length + Object.keys(textOnLeft()).length;
console.log(all, JSON.stringify(Object.entries(byTexts()).map(([key, list]) => [key, list.length])));
console.log(JSON.stringify(byTextAndNumber()));
console.log(JSON.stringify(textOnLeft()));
