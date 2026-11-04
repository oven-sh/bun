// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
let table: Table = { handler: step, bias: 1 };
const later: Table = { handler: (x) => x - 2, bias: 5 };
function step(x: number): number {
  if (x > 900) table = later;
  return x + 3;
}
function run(times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
(globalThis as any).tables = [table, later];
(0, eval)("1");
console.log(run(1000));
