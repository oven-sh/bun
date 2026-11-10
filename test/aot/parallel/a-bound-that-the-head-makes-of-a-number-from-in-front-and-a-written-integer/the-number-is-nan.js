// STATISTIC: NumbersBesideCountersAskedInFrontOfLoops >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8]');
function walk(n) { let s = 0, c = 0; for (let i = 0; i < n - 1; i++) { s += list[i & 7]; if (++c === 12) break; } return s * 100 + c; }
console.log(walk(JSON.parse('1e400') - JSON.parse('1e400')), walk(JSON.parse('6')));
