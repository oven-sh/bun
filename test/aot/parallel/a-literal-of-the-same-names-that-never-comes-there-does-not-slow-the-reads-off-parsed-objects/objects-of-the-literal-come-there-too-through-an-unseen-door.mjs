const own = [{ x: 1, y: 2 }, { x: 3.5, y: 4 }];
const rows = JSON.parse('[{"x":5,"y":6},{"y":7,"x":8},{"x":9,"y":10,"z":1}]');
function sum(d) { let total = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; total += a.x * 2 + a.y * 3 + a.x; } return total; }
const byName = { sum }, key = JSON.parse('"sum"');
const mixed = JSON.parse("[0,1,2,3,4]").map((at) => (at < 3 ? rows[at] : own[at - 3]));
let all = 0; for (let k = 0; k < 4000; k++) all = (all + byName[key](k % 3 === 0 ? mixed : rows)) % 1000003;
console.log(all, JSON.stringify(own));
