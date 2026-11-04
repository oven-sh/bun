// One shape. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy. Here the test, the deed or the throw stands in the copy of a callee.
// What nobody has seen is done by eval: an accessor laid over a field.
type Box = { w: number; h: number; tag: string };
type Table = { scale: number };
let deeds = 0;
let calls = 0;
function area(box: Box): number { return box.w * box.h + box.tag.length; }
function run(table: Table): number {
  const boxes: Box[] = [];
  for (let i = 0; i < 8; i++) boxes.push({ w: i + 1, h: i + 2, tag: "t" });
  (globalThis as any).odd = boxes[5];
  (0, eval)("Object.defineProperty(odd, 'w', { get() { return 6; }, enumerable: true, configurable: true })");
  let total = 0;
  for (let i = 0; i < 1000; i++) total += area(boxes[i & 7]) * table.scale;
  return total;
}
(globalThis as any).entries = [run];
(0, eval)("1");
console.log(run({ scale: 2 }));
