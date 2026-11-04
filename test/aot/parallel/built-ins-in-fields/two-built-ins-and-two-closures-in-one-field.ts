// More than one of each: nobody can name them.
type Table = { handler: (x: number) => number };
function run(table: Table, times: number): number {
  let sum = 0.5;
  for (let i = 0; i < times; i++) sum = table.handler(sum - 7.25);
  return sum;
}
function main() {
  const tables: Table[] = [{ handler: x => x + 3 }, { handler: Math.abs }, { handler: Math.floor }, { handler: x => -x }];
  console.log(tables.map(table => run(table, 101)).join());
}
main();
