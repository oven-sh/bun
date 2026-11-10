// STATISTIC: NumbersBesideCountersAskedInFrontOfLoops >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8]');
function walk(n) { let s = 0, c = 0; for (let i = 0; i < n - 1; i++) { s += list[i & 7]; if (++c === 12) break; } return s * 100 + c; }
const odd = [6n, 5][JSON.parse('0')];
console.log(walk(JSON.parse('5')));
try { console.log(walk(odd)); } catch (error) { console.log(error instanceof TypeError); }
console.log(walk(JSON.parse('5')));
