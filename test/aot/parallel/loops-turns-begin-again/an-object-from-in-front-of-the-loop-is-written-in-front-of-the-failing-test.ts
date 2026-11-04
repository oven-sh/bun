// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
function run(boxes: Box[]): number {
  const tally = { count: 0, sum: 0 };
  for (let i = 0; i < boxes.length; i++) {
    tally.count += 1;
    tally.sum += boxes[i].value;
  }
  return tally.count * 100000 + tally.sum;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 90; i++) boxes.push({ value: i });
  boxes[45] = { name: "n", value: 2 } as any;
  boxes[46] = { name: "m", value: 3 } as any;
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  console.log(run(boxes));
}
main();
