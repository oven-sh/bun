// The same two records, handed to code that no build has seen, which lays a third function into one of them.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum - 7) + table.bias) | 0;
  return sum;
}
function main() {
  const own: Table = { handler: x => x + 3, bias: 1 }, native: Table = { handler: Math.abs, bias: 1 };
  (globalThis as any).tables = [own, native];
  console.log(run(own, 1000), run(native, 1000));
  (0, eval)("tables[1].handler = x => x * 2; tables[0].bias = 'b'");
  console.log(run(own, 3), run(native, 10));
}
main();
