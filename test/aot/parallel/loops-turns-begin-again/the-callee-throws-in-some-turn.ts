// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
let turns = 0;
function run(table: Table, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    sum = (table.handler(sum) + table.bias) | 0;
    turns++;
  }
  return sum;
}
function main() {
  const table: Table = { handler: (x) => { if (x > 200) throw new RangeError("far"); return x + 3; }, bias: 1 };
  (globalThis as any).table = table;
  (0, eval)("1");
  let said = "";
  try {
    run(table, 1000);
  } catch (error) {
    said = (error as Error).message;
  }
  console.log(said, turns);
}
main();
