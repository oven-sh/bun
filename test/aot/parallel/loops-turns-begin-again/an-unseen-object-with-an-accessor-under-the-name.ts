// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Box = { value: number };
let reads = 0;
function main() {
  (globalThis as any).count = () => ++reads;
  (0, eval)("1");
  const boxes: Box[] = [{ value: 1 }, { value: 2 }, (0, eval)("({ get value() { return count(); } })"), { value: 4 }];
  let total = 0;
  for (let i = 0; i < 400; i++) total += boxes[i & 3].value;
  console.log(total, reads);
}
main();
