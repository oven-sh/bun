// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
function main() {
  const table: Table = { handler: (x) => x + 3, bias: 1 };
  (globalThis as any).table = table;
  (globalThis as any).run = run;
  (0, eval)("1");
  console.log(run(table, 1000), run((0, eval)("({ bias: 2, handler: function (x) { return x + 1; } })"), 1000), run((0, eval)("Object.create(table)"), 1000), run(table, 0), run((0, eval)("null"), 0));
}
main();
