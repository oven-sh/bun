const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
function outer(start) { let n = start; const cut = () => { n -= 3; }; let s = 0; for (let i = 0; i < n - 1; i++) { s += list[i]; if (i === 1) cut(); } return s; }
console.log(outer(JSON.parse('10')), outer(JSON.parse('4')));
