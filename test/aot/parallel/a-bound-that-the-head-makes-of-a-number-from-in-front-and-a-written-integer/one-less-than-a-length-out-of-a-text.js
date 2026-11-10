// STATISTIC: InvariantNumberGuardsHoisted >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
function pairs(n) { let s = 0; for (let i = 0; i < n - 1; i++) s += list[i] * list[i + 1]; return s; }
console.log(pairs(JSON.parse('10')), pairs(JSON.parse('1')), pairs(JSON.parse('0')));
