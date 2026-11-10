// The twin: the same chain with the functions written in place: the doors pass by the closures, and nothing is counted by a name.
// STATISTIC: GuessesAtListsOpenedForFunctionsHandedByName = 0
function run(rows, turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum += rows.map(row => row.qty * 2).filter(value => value > 2).reduce((total, value) => total + value, 0); return sum; }
const table = { run };
console.log(table[JSON.parse('"run"')](JSON.parse('[{"qty":1},{"qty":2},{"qty":3}]'), 3));
