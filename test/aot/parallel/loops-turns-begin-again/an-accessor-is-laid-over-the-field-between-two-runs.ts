// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
let reads = 0;
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
function main() {
  const table: Table = { handler: (x) => x + 3, bias: 1 };
  (globalThis as any).table = table;
  (globalThis as any).count = () => { reads++; return 2; };
  (0, eval)("1");
  const first = run(table, 100);
  (0, eval)("Object.defineProperty(table, 'bias', { get() { return count(); }, configurable: true })");
  const second = run(table, 100);
  (0, eval)("delete table.bias");
  const third = run(table, 3);
  console.log(first, second, reads, third);
}
main();
