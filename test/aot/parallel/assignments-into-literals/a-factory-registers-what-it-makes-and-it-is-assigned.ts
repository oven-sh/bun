// STATISTIC: OwnKeyWalksExpanded >= 1
interface First { z: number; y: number }
interface Later { a: number; b: number }
const box: { held: Later } = { held: { a: 0, b: 0 } };
function born(z: number, y: number): First { return { z, y }; }
function make(a: number, b: number): Later { const o: Later = { a, b }; box.held = o; return o; }
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { box.held.a = 10; return 3; }, enumerable: true });
function total(rows: First[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i];
    const later = make(start, i);
    const made = Object.assign({ id: 7, z: 0, y: 0, a: 0, b: 0 }, first, later);
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), tricky, born(1, 2)], 1));
