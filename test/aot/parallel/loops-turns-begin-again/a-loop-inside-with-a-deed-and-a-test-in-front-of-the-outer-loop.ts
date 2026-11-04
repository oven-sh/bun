// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen is done by eval: an accessor laid over a field, a function of its own in a field.
type Box = { value: number };
type Table = { scale: number };
let deeds = 0;
function run(table: Table): number {
  const boxes: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 60 }, { value: 7 }, { value: 8 }];
  // The object leaves, the list does not. An accessor is laid over its field.
  (globalThis as any).odd = boxes[5];
  (0, eval)("Object.defineProperty(odd, 'value', { get() { return 60; }, enumerable: true, configurable: true })");
  let total = 0;
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 8; i++) {
      total += boxes[i].value * table.scale;
      deeds++;
    }
  }
  return total;
}
(globalThis as any).run = run;
(0, eval)("1");
console.log(run({ scale: 2 }), deeds);
