// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen is done by eval: an accessor laid over a field, a function of its own in a field.
type Box = { value: number };
function main() {
  (0, eval)("1");
  const boxes: Box[] = [{ value: 1 }, { value: 2 }, { value: 60 }, { value: 4 }, { value: 5 }, { value: -6 }, { value: 7 }, { value: 8 }];
  // The object leaves, the list does not. An accessor is laid over its field.
  (globalThis as any).odd = boxes[2];
  (0, eval)("Object.defineProperty(odd, 'value', { get() { return 60; }, enumerable: true, configurable: true })");
  let total = 0;
  let i = 0;
  for (; i < 1000; i++) {
    const value = boxes[i & 7].value;
    if (value < 0) break;
    if (value === 4) continue;
    total += value;
  }
  console.log(total, i);
}
main();
