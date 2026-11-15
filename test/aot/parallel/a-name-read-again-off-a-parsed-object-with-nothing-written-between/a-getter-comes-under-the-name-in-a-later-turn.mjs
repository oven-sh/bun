const rows = JSON.parse('[{"y":1},{"y":2},{"y":3}]');
let calls = 0;
function run(d) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; sum += a.y + a.y * 2 + a.y * 3; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0;
for (let k = 0; k < 3000; k++) { if (k === 1500) Object.defineProperty(rows[1], "y", { get() { return ++calls & 3; }, configurable: true }); all = (all + byName[key](rows)) % 1000003; }
console.log(all, calls);
