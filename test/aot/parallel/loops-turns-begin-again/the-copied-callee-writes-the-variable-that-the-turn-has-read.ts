// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
let step = 1;
const table: Table = { handler: (x) => { step = (x & 7) + 1; return x + 3; }, bias: 1 };
function run(times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.bias + step + table.handler(sum)) | 0;
  return sum;
}
(globalThis as any).table = table;
(0, eval)("1");
console.log(run(1000), step);
