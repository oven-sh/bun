const own = { y: 1 };
const rows = JSON.parse('[{"y":1},{"y":2},{"y":3}]'); rows.push(own);
function run(d) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; const first = a.y; own.y = first + 1; sum += first * 10 + a.y; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0; for (let k = 0; k < 4000; k++) { all = (all + byName[key](rows)) % 1000003; own.y %= 7; }
console.log(all);
