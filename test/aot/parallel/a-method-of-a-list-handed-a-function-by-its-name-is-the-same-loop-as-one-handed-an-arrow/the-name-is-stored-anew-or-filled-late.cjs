// The name handed over does not always hold the function that was declared under it: it is stored anew between two turns and inside a turn; a `let` is filled late; a `var` holds undefined at first; a parameter shadows the name.
const rows = JSON.parse("[1,2,3,4,5,6]");
function big(value) { return value > 2; }
function small(value) { return value < 3; }
function twice(value) { return value * 2; }
function thrice(value) { return value * 3; }
function add(total, value) { return total + value; }
function work(rows) { return rows.map(twice).filter(big).reduce(add, 0); }
const table = { work };
const call = () => table[JSON.parse('"work"')](rows);
const said = [];
for (let turn = 0; turn < 6; turn++) {
  if (turn === 2) big = small;
  if (turn === 4) twice = thrice;
  said.push(call());
}
function swaps(value) { add = (total, value) => total - value; return value; }
said.push(rows.map(swaps).reduce(add, 0), rows.reduce(add, 0));
let late; function usesLate(rows) { return rows.map(late); }
try { said.push(usesLate(rows).join()); } catch (error) { said.push(error.constructor.name); }
late = thrice; said.push(usesLate(rows).join());
function shadowed(rows, twice) { return rows.map(twice).join(); }
said.push(shadowed(rows, small));
try { said.push(rows.map(early).join()); } catch (error) { said.push(error.constructor.name); }
var early = thrice; said.push(rows.map(early).join());
console.log(said.join(" | "));
