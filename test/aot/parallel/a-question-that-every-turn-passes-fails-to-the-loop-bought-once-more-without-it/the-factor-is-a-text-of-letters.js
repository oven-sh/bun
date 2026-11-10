// STATISTIC: LoopsBoughtOnceMoreWithoutQuestionsOfEveryTurn >= 1
const parts = JSON.parse('[0.5,"x"]');
const list = JSON.parse('[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]');
const low = parts[0], odd = parts[1];
function scale(a, b) { return a * b; }
function total(turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + list[i] + scale(low, odd); return sum; }
console.log(total(0), total(1));
