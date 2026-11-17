const rows = JSON.parse('[[1,2],[3,4],[5,6]]');
function run(d) { let sum = 0; for (let i = 0; i < d.length; i++) { const a = d[i]; const first = a.length; a[first] = 1; sum += first * 10 + a.length; a.length = 2; } return sum; }
const byName = { run }, key = JSON.parse('"run"');
let all = 0; for (let k = 0; k < 4000; k++) all = (all + byName[key](rows)) % 1000003;
console.log(all);
