// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
let deeds = 0;
function run(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    total += boxes[i].value;
    deeds++;
  }
  return total;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 300; i++) boxes.push({ value: i });
  boxes[150] = { extra: true, value: 1000 } as any;
  boxes[151] = Object.create({ value: 2000 });
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  console.log(run(boxes), deeds);
}
main();
