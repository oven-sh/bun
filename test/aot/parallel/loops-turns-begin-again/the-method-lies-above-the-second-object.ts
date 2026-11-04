// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
function main() {
  const table: Table = { handler: (x) => x + 3, bias: 1 };
  const below: Table = Object.create(table);
  const hidden: Table = Object.create({ handler: (x: number) => x + 9, bias: 4 });
  (globalThis as any).tables = [table, below, hidden];
  (0, eval)("1");
  console.log(run(table, 100), run(below, 100), run(hidden, 100));
}
main();
