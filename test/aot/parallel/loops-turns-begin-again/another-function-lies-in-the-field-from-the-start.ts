// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
function main() {
  const first: Table = { handler: (x) => x + 3, bias: 1 };
  const second: Table = { handler: (x) => x * 2 + 1, bias: 1 };
  (globalThis as any).tables = [first, second];
  (0, eval)("1");
  console.log(run(first, 1000), run(second, 40), run(first, 0), run(second, 0));
}
main();
