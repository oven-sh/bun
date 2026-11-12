// The five programs beside this one hold the answers; this one holds the event: the chain stands in a loop of `run`, the three functions are given by their names, and the guesses at the lists are opened for them.
// STATISTIC: ReceiversSpeculatedForNamedCallbacks >= 1
function twice(row) { return row.qty * 2; }
function big(value) { return value > 2; }
function add(total, value) { return total + value; }
function run(rows, turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum += rows.map(twice).filter(big).reduce(add, 0); return sum; }
const table = { run };
console.log(table[JSON.parse('"run"')](JSON.parse('[{"qty":1},{"qty":2},{"qty":3}]'), 3));
