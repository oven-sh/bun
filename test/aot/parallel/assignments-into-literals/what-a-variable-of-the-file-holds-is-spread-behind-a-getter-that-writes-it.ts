// STATISTIC: OwnKeyWalksExpanded >= 1
interface First { z: number; y: number }
interface Later { a: number; b: number }
let current: Later = { a: 0, b: 0 };
function born(z: number, y: number): First { return { z, y }; }
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { current.a = 10; return 3; }, enumerable: true });
function total(rows: First[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i];
    current = { a: start, b: i };
    const held = current;
    const made = { id: 7, ...first, ...held };
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), tricky, born(1, 2)], 1));
