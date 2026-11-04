const unseen = (0, eval)("(x) => x");
class Box { v: number; constructor(v: number) { this.v = v; } }
class Item { box: Box | null; constructor(box: Box | null) { this.box = box; } }
class Scale { by: number; constructor(by: number) { this.by = by; } }
function pick(item: Item, other: Item): number {
  let got = 0;
  try { got = other.box!.v; } catch (e) { return e ? -1 : -2; }
  try { got += item.box!.v; } catch { throw "no box"; }
  return got;
}
const scales: Scale[] = [new Scale(2)];
if (unseen(0)) scales.push(unseen(0));
function total(full: Item, empty: Item, n: number, last: Item): number {
  const scale = scales[0];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += scale.by + pick(i === n - 1 ? last : full, i % 7 === 3 ? empty : full);
  return sum;
}
const full = new Item(new Box(10)), empty = new Item(null);
console.log(total(full, empty, 300, full));
try { console.log(total(full, empty, 300, empty)); } catch (e) { console.log(String(e)); }
