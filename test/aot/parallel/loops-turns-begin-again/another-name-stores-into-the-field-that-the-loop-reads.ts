// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Table = { handler: (x: number) => number; bias: number };
const add3 = (x: number) => x + 3;
function run(table: Table, alias: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    sum = (table.handler(sum) + table.bias) | 0;
    alias.bias = i & 7;
  }
  return sum;
}
function main() {
  const table: Table = { handler: add3, bias: 1 };
  const apart: Table = { handler: add3, bias: 1 };
  (globalThis as any).held = [table, apart, run];
  (0, eval)("1");
  console.log(run(table, table, 1000), run(table, apart, 1000));
}
main();
