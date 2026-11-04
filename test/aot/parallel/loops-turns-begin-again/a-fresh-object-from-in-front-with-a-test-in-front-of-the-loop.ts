// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen is done by eval: an accessor laid over a field, a function of its own in a field.
type Box = { value: number };
type Table = { scale: number };
function run(table: Table): string {
  const boxes: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 60 }, { value: 7 }, { value: 8 }];
  // The object leaves, the list does not. An accessor is laid over its field.
  (globalThis as any).odd = boxes[5];
  (0, eval)("Object.defineProperty(odd, 'value', { get() { return 60; }, enumerable: true, configurable: true })");
  const tally = { count: 0, sum: 0 };
  for (let i = 0; i < 1000; i++) {
    tally.count += 1;
    tally.sum += boxes[i & 7].value * table.scale;
  }
  return tally.count + " " + tally.sum;
}
(globalThis as any).run = run;
(0, eval)("1");
console.log(run({ scale: 2 }));
