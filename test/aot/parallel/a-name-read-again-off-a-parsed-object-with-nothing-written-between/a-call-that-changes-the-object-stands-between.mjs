const rows = JSON.parse('[{"y":1},{"y":2},{"y":3}]');
let turns = 0;
function touch(row) { if (++turns % 5 === 0) row.y += 1; return 1; }
function run(d) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; sum += a.y * 100 + touch(a) + a.y; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0; for (let k = 0; k < 4000; k++) { all = (all + byName[key](rows)) % 1000003; for (const row of rows) row.y %= 9; }
console.log(all, turns);
