const rows = JSON.parse('[{"y":1},{"y":2},{"y":3},{"y":4}]');
function run(d, shift) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i], b = d[(i + shift) % d.length]; const first = a.y; b.y = first + 1; sum += first * 10 + a.y; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0; for (let k = 0; k < 4000; k++) { all = (all + byName[key](rows, k % 2 === 0 ? 0 : 1)) % 1000003; for (const row of rows) row.y %= 7; }
console.log(all);
