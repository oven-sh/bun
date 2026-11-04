// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
let reached = -1;
function run(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    total += boxes[i].value;
    reached = i;
  }
  return total;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 100; i++) boxes.push({ value: i });
  boxes[60] = null as any;
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  let said = "";
  try {
    run(boxes);
  } catch (error) {
    said = (error as Error).constructor.name;
  }
  console.log(said, reached);
}
main();
