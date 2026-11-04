// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Table = { handler: (x: number) => number; bias: number };
const table: Table = { handler: (x) => { table.bias = (x & 3) + 1; return x + 3; }, bias: 1 };
function run(times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
(globalThis as any).table = table;
(0, eval)("1");
console.log(run(1000));
