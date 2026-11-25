// STATISTIC: OwnKeyWalksExpanded >= 1
interface Given { z: number; y: number }
interface Options { a: number; b: number }
function born(z: number, y: number): Given { return { z, y }; }
const shelf: Options[] = [];
function create(a: number, b: number): Options { const options: Options = { a, b }; shelf.push(options); return options; }
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { shelf[shelf.length - 1]!.a = 10; return 3; }, enumerable: true });
function total(rows: Given[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const options = create(start, i);
    const made = { ...rows[i], ...options };
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), tricky, born(1, 2)], 1));
