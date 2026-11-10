// `n + 1` says nothing of n: a text plus one is a longer text: nothing is made in front for it.
const list = JSON.parse('[1,2,3,4,5,6,7,8]');
function walk(n) { let s = 0, c = 0; for (let i = 0; i < n + 1; i++) { s += list[i & 7]; if (++c === 12) break; } return s * 100 + c; }
console.log(walk(JSON.parse('9')), walk(JSON.parse('0')), walk(JSON.parse('-1')), walk(JSON.parse('-2')));
