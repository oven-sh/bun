// STATISTIC: InvariantNumberGuardsHoisted >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
function sum(n) { let s = 0; for (let i = 0; i <= n - 1; i++) s += list[i]; return s; }
console.log(sum(JSON.parse('10')), sum(JSON.parse('1')), sum(JSON.parse('0')), sum(JSON.parse('-3')));
