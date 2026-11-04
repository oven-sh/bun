// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
type Odd = { other: number; value: string };
const log: number[] = [];
let deeds = 0;
function run(boxes: Box[]): string {
  let total: any = 0;
  for (let i = 0; i < boxes.length; i++) {
    deeds++;
    log.push(i);
    total += boxes[i].value;
  }
  return String(total);
}
function main() {
  const boxes: Box[] = [];
  for (let i = 0; i < 300; i++) boxes.push({ value: i });
  const odd: Odd = { other: 1, value: "x" };
  boxes[150] = odd as any;
  (globalThis as any).boxes = boxes;
  (0, eval)("1");
  const answer = run(boxes);
  console.log(answer.length, answer.slice(0, 12), deeds, log.length, log[150], log[151], log[299]);
}
main();
