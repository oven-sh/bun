// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Pair = { left: number; right: number };
type Box = { value: number };
const kept: Pair[] = [];
function run(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    const pair: Pair = { left: i, right: i * 2 };
    pair.right += boxes[i].value;
    kept.push(pair);
    total += pair.left + pair.right;
  }
  return total;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 120; i++) boxes.push({ value: i });
  boxes[33] = { zero: 0, value: 8 } as any;
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  const total = run(boxes);
  console.log(total, kept.length, kept[33].left, kept[33].right, kept[34].right, new Set(kept).size);
}
main();
