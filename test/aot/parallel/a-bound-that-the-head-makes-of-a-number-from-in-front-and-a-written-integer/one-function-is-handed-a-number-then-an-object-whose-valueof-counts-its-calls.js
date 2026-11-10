// STATISTIC: NumbersBesideCountersAskedInFrontOfLoops >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8]');
function walk(n) { let s = 0, c = 0; for (let i = 0; i < n - 1; i++) { s += list[i & 7]; if (++c === 12) break; } return s * 100 + c; }
let asked = 0;
const odd = [{ valueOf() { asked++; return 5; } }, 5][JSON.parse('0')];
console.log(walk(JSON.parse('5')), asked, walk(odd), asked, walk(JSON.parse('5')), asked);
