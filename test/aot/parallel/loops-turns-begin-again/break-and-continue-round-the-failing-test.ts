// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number; skip: boolean };
function run(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box.skip) continue;
    if (box.value < 0) break;
    total += box.value;
  }
  return total;
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 300; i++) boxes.push({ value: i, skip: i % 5 === 0 });
  boxes[100] = { skip: false, value: 7, more: 1 } as any;
  boxes[101] = { more: 2, skip: true, value: 9 } as any;
  boxes[250] = { value: -1, skip: false };
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  console.log(run(boxes));
}
main();
