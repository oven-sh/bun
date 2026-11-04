// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
let calls = 0;
function run(table: Table, times: number): number {
  let sum = 7;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
function main() {
  const table: Table = { handler: (x) => x + 3, bias: 1 };
  const withGetter = { get handler() { calls++; return (x: number) => x; }, get bias() { calls++; return 1; } };
  (globalThis as any).tables = [table, withGetter];
  (0, eval)("1");
  console.log(run(table, 0), run(withGetter as any, 0), calls, run(null as any, 0), run(withGetter as any, 3), calls);
}
main();
