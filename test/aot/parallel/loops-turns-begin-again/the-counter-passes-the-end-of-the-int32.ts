// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum = (table.handler(sum) + table.bias + (i % 3)) | 0;
  return sum;
}
function main() {
  const table: Table = { handler: (x) => x + 3, bias: 1 };
  const second: Table = { handler: (x) => x + 5, bias: 1 };
  (globalThis as any).tables = [table, second];
  (0, eval)("1");
  console.log(run(table, 2147483600, 2147483700), run(second, 2147483600, 2147483700), run(table, 0.5, 20.25), run(second, -3.5, 9));
}
main();
