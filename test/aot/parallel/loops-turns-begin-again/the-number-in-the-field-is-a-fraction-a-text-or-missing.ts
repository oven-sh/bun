// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Box = { value: number };
function sum(boxes: Box[]): string {
  let total: any = 0;
  for (let i = 0; i < 40; i++) total += boxes[i & 3].value;
  return String(total).slice(0, 24);
}
function main() {
  (globalThis as any).sum = sum;
  (0, eval)("1");
  const whole: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }];
  const fraction: Box[] = [{ value: 1 }, { value: 2.5 }, { value: 3 }, { value: 4 }];
  const text: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }];
  (globalThis as any).text = text;
  (0, eval)("text[2].value = 'x'");
  const missing: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }];
  (globalThis as any).missing = missing;
  (0, eval)("delete missing[1].value");
  console.log(sum(whole), sum(fraction), sum(text), sum(missing));
}
main();
