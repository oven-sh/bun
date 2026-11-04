// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Table = { handler: (x: number) => number; bias: number };
let seen = 0;
function run(table: Table, boxes: { value: number }[]): number {
  let sum = 0;
  for (let i = 0; i < boxes.length; i++) sum = (table.handler(sum) + boxes[i].value) | 0;
  return sum;
}
function main() {
  const table: Table = { handler: (x) => { seen++; return x + 3; }, bias: 1 };
  const boxes: { value: number }[] = [];
  for (let i = 0; i < 200; i++) boxes.push({ value: i });
  boxes[77] = { first: 0, value: 4 } as any;
  (globalThis as any).held = [table, boxes];
  (0, eval)("1");
  console.log(run(table, boxes), seen);
}
main();
