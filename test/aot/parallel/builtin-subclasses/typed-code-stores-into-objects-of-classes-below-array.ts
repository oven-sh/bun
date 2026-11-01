// COUNT: arrivals <= 40
class Cells extends Array<number> {
  set(i: number, v: number): void {
    this[i] = v;
  }
  get(i: number): number {
    return this[i]!;
  }
}
const cells = new Cells();
cells.push(1, 2, 3, 4);
let sum = 0;
for (let i = 0; i < 1000; i++) {
  cells.set(i & 3, i);
  sum += cells.get(i & 3);
}
console.log(sum);
