// The product stands in the text of the loop, in no callee copied into it. Its question fails to the other copy as it always did: a loop bought once more would run no faster there and only weigh.
// STATISTIC: LoopsBoughtOnceMoreWithoutQuestionsOfEveryTurn = 0
const parts = JSON.parse('[0.5,"3"]'), list = JSON.parse('[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]');
const low = parts[0], odd = parts[1];
function total(turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + list[i] + low * odd; return sum; }
console.log(total(0), total(1));
