// STATISTIC: InvariantNumberGuardsHoisted >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
function sum(n) { let s = 0; for (let i = 0; i < n - 1; i++) s += list[i] === undefined ? 100 : list[i]; return s; }
console.log(sum(JSON.parse('13')), sum(JSON.parse('11')));
