// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
let deeds = 0;
function run(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (i % 3 === 0) deeds++;
    total += boxes[i].value;
  }
  return total;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 200; i++) boxes.push({ value: i });
  boxes[99] = { odd: 1, value: 1 } as any;
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  console.log(run(boxes), deeds);
}
main();
