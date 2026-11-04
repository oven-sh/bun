// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
function run(boxes: Box[]): number {
  const made: (() => number)[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const value = boxes[i].value;
    made.push(() => value * 10 + i);
  }
  let total = made.length;
  for (let i = 0; i < made.length; i++) total += made[i]();
  return total;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 100; i++) boxes.push({ value: i });
  boxes[40] = { deep: 1, value: 3 } as any;
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  console.log(run(boxes));
}
main();
