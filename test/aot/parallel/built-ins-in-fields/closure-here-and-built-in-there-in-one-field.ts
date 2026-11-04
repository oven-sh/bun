// Two records of one type: the field of one holds a closure, that of the other a built-in. Nothing leaves the program.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum - 7) + table.bias) | 0;
  return sum;
}
function main() {
  const own: Table = { handler: x => x + 3, bias: 1 }, native: Table = { handler: Math.abs, bias: 1 };
  console.log(run(own, 1000), run(native, 1000), run(native, 1), run(own, 1));
}
main();
