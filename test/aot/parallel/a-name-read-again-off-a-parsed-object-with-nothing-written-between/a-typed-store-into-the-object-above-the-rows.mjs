const own = { y: 1 };
const text = '[{"y":1},{"y":2},{"y":3},{"y":4}]';
function run(d, extra) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; const first = a.y; own.y = i + 5; sum += first * 4096 + a.y; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0, got = 0;
for (let k = 0; k < 4000; k++) { const rows = JSON.parse(text); own.y = 1; for (const row of rows) { Object.setPrototypeOf(row, own); delete row.y; } got = byName[key](rows, 0); all = (all + got) % 1000003; }
console.log("SAID kind " + typeof got);
console.log("SAID first " + Math.floor(got / 4096));
console.log("SAID second " + got % 4096);
console.log("SAID all " + all);
