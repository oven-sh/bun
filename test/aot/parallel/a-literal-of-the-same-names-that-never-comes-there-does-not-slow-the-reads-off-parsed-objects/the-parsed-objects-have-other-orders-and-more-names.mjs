const shown = JSON.stringify({ x: 1, y: 2 });
const rows = JSON.parse('[' + shown + ',{"y":3,"x":4},{"w":0,"x":5,"y":6},{"x":"7","y":8},{"x":9}]');
function tell(d) { let told = ""; for (let i = 0; i < d.length; i++) { const a = d[i]; told += a.x + "," + a.y + ";"; } return told.length; }
function add(d) { let total = 0; for (let i = 0; i < 3; i++) { const a = d[i]; total += a.x + a.y; } return total; }
const byName = { tell, add }, keys = JSON.parse('["tell","add"]');
let all = 0; for (let k = 0; k < 4000; k++) all = (all + byName[keys[k & 1]](rows)) % 1000003;
console.log(all);
