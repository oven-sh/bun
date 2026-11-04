// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
function run(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    total += boxes[i].value;
    if (boxes[i].value === 5 && boxes.length < 40) boxes.push({ value: 5 });
  }
  return total * 100 + boxes.length;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 10; i++) boxes.push({ value: i });
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  console.log(run(boxes));
}
main();
