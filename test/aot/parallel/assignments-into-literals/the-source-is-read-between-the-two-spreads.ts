// STATISTIC: OwnKeyWalksExpanded >= 1
interface Given { z: number; y: number }
interface Options { a: number; b: number }
function born(z: number, y: number): Given { return { z, y }; }
const box: { options: Options } = { options: { a: 0, b: 0 } };
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { box.options.a = 10; return 3; }, enumerable: true });
function total(rows: Given[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    box.options = { a: start, b: i };
    const made = { id: 7, ...rows[i], ...box.options };
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), tricky, born(1, 2)], 1));
