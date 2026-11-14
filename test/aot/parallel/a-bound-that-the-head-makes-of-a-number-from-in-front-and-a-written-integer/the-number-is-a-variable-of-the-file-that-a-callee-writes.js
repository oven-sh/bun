const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
let n = JSON.parse('10');
function cut() { n -= 4; }
function run() { let s = 0; for (let i = 0; i < n - 1; i++) { s += list[i]; if (i === 2) cut(); } return s; }
console.log(run(), n, run(), n);
