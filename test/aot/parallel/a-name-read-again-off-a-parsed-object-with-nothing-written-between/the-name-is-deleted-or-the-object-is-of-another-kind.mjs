const rows = JSON.parse('[{"y":1,"z":1},{"y":2},{"z":5,"y":3}]');
const odd = [rows[0], new Proxy({ y: 4 }, { get(target, name) { return name === "y" ? ++reads : undefined; } }), [7], "text", { get y() { return ++reads; } }];
var reads = 0;
function run(d) { let told = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; told += (a.y | 0) + (a.y | 0) * 2; } return told; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0;
for (let k = 0; k < 3000; k++) { if (k === 1000) delete rows[1].y; if (k === 2000) rows[1].y = 9; all = (all + byName[key](k % 100 === 99 ? odd : rows)) % 1000003; }
console.log(all, reads);
