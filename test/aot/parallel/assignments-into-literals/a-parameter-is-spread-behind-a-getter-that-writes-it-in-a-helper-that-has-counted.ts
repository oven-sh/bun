// STATISTIC: OwnKeyWalksExpanded >= 1
interface First { z: number; y: number }
interface Later { a: number; b: number }
const box: { held: Later } = { held: { a: 0, b: 0 } };
function born(z: number, y: number): First { return { z, y }; }
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { box.held.a = 10; return 3; }, enumerable: true });
let calls = 0;
function fill(first: First, later: Later) { calls++; return { id: 7, ...first, ...later }; }
function total(rows: First[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i];
    const later: Later = { a: start, b: i };
    box.held = later;
    const made = fill(first, later);
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), tricky, born(1, 2)], 1));
