let level = 1;
const rows = JSON.parse('[{"y":1},{"y":2}]'); rows.push({ get y() { return level; } });
function run(d) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; const first = a.y; level = first + 1; sum += first * 10 + a.y; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0; for (let k = 0; k < 4000; k++) { all = (all + byName[key](rows)) % 1000003; level %= 7; }
console.log(all);
