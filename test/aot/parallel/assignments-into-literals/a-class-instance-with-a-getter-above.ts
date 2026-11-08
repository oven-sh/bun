// STATISTIC: OwnKeyWalksExpanded >= 1
interface Given { z: number; y: number }
interface Options { a: number; b: number }
function born(z: number, y: number): Given { return { z, y }; }
let current: Options = { a: 0, b: 0 };
class Lazy { y = 2; get z() { current.a = 10; return 3; } }
function merge(given: Given, start: number, i: number) {
  current = { a: start, b: i };
  return Object.assign({ id: 7, z: 5, y: 0, a: 0, b: 0 }, given, current);
}
function total(rows: Given[], start: number): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const made = merge(rows[i], start, i);
    sum = (sum * 7 + made.a * 10 + made.z) % 1000003;
  }
  return sum;
}
console.log(total([born(1, 2), born(1, 2), born(1, 2)], 1), total([born(1, 2), new Lazy(), born(1, 2)], 1));
