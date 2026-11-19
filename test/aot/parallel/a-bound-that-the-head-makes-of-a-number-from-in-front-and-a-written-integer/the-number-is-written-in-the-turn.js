const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
function shrink(n) { let s = 0; for (let i = 0; i < n - 1; i++) { s += list[i]; if (list[i] === 3) n -= 2; } return s; }
console.log(shrink(JSON.parse('10')), shrink(JSON.parse('3')));
