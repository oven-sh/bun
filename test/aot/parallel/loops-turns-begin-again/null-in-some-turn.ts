// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Box = { value: number };
function main() {
  (0, eval)("1");
  const boxes: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, (0, eval)("null")];
  let total = 0;
  let reached = -1;
  let said = "";
  try {
    for (let i = 0; i < 100; i++) {
      total += boxes[i & 3].value;
      reached = i;
    }
  } catch (error) {
    said = (error as Error).constructor.name;
  }
  console.log(total, reached, said);
}
function bare(): string {
  const boxes: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, (0, eval)("undefined")];
  let total = 0;
  for (let i = 0; i < 100; i++) total += boxes[i & 3].value;
  return String(total);
}
main();
try {
  console.log(bare());
} catch (error) {
  console.log((error as Error).constructor.name);
}
