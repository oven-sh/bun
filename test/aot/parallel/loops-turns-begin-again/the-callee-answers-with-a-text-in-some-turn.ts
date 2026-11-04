// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
function run(table: Table, times: number): string {
  let sum: any = 0;
  for (let i = 0; i < times; i++) sum = table.handler(sum) + table.bias;
  return String(sum);
}
function main() {
  const table: Table = { handler: ((x: any) => (x === 300 ? "t" : x + 2)) as any, bias: 1 };
  (globalThis as any).table = table;
  (0, eval)("1");
  const answer = run(table, 110);
  console.log(answer.length, answer.slice(0, 10));
}
main();
