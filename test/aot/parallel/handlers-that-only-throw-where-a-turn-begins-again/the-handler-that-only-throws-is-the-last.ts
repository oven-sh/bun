const unseen = (0, eval)("(x) => x");
class Box { v: number; constructor(v: number) { this.v = v; } }
class Item { box: Box | null; constructor(box: Box | null) { this.box = box; } }
class Scale { by: number; constructor(by: number) { this.by = by; } }
function pick(item: Item, floor: number): number {
  try { if (floor > 40) throw 1; } catch { throw "the floor is too high"; }
  let got = 0;
  try { got = item.box!.v; } catch (e) { return e ? -1 : -2; }
  return got;
}
const scales: Scale[] = [new Scale(2)];
if (unseen(0)) scales.push(unseen(0));
function total(full: Item, empty: Item, n: number, floor: number): number {
  const scale = scales[0];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += scale.by + pick(i % 7 === 3 ? empty : full, floor);
  return sum;
}
const full = new Item(new Box(10)), empty = new Item(null);
console.log(total(full, empty, 300, 0));
try { console.log(total(full, empty, 300, 50)); } catch (e) { console.log(String(e)); }
