// STATISTIC: OwnKeyWalksExpanded >= 1
interface Given { z: number; y: number }
interface Options { a: number; b: number }
function born(z: number, y: number): Given { return { z, y }; }
class Runner {
  options: Options = { a: 0, b: 0 };
  merge(given: Given, start: number, i: number) {
    this.options = { a: start, b: i };
    return Object.assign({ id: 7 }, given, this.options);
  }
}
const runner = new Runner();
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { runner.options.a = 10; return 3; }, enumerable: true });
function total(rows: Given[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const made = runner.merge(rows[i], start, i);
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), tricky, born(1, 2)], 1));
