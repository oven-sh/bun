const numbers = JSON.parse("[0,1,2,3,4,5]");
function storeInTurns(list, to, turns) { let total = 0; for (let i = 0; i < turns; i++) { list.length = to >>> 0; total += list.length; } return total; }
const frozen = [1, 2, 3]; Object.freeze(frozen);
console.log(storeInTurns(frozen, numbers[3], 5), storeInTurns(frozen, numbers[1], 5), storeInTurns([1, 2, 3], numbers[1], 5), storeInTurns([1, 2, 3], numbers[5], 5));
