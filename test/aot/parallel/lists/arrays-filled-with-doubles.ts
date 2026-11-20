// new Array(n).fill(0) into which the program stores fractions: of every length, kind of number and use.
function sums(n: number, step: number): number[] {
  const list: number[] = new Array(n).fill(0);
  for (let i = 0; i < list.length; i++) list[i] += i * step;
  return list;
}
function halves(n: number): number[] {
  const list: number[] = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) list[i] = list[i] / 2;
  return list;
}
function negative(n: number): string {
  const list: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) list[i] = i ? -list[i - 1] * 0.5 : list[i] * -1;
  return list.map(x => (Object.is(x, -0) ? "-0" : String(x))).join();
}
function untouched(n: number): string {
  const list: number[] = new Array(n).fill(7);
  if (n > 100) list[0] = 0.5;
  return list.join() + " " + list.includes(7) + " " + JSON.stringify(list) + " " + list.indexOf(7);
}
function mixed(n: number, other: any): string {
  const list: any[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) list[i] += i === 2 ? other : 0.25;
  return list.map(x => typeof x + String(x)).join();
}
function grown(n: number): string {
  const list: number[] = new Array(n).fill(0);
  list[0] = 1.5;
  list.push(2.5, 3);
  list.length += 1;
  list[n + 5] = 4.5;
  return list.join() + " " + list.length + " " + (n in list) + " " + (n + 3 in list);
}
function nan(n: number): string {
  const list: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) list[i] = i % 2 ? NaN : i / 4;
  return list.join();
}
function matrix(n: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) rows.push(new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows[i][j] += (i + 1) / (j + 1);
  return rows;
}
class Field {
  cells: number[];
  constructor(readonly width: number, readonly height: number) {
    this.cells = new Array(width * height).fill(0);
  }
  add(x: number, y: number, value: number): void {
    this.cells[y * this.width + x] += value;
  }
}
for (const n of [0, 1, 2, 5, 9]) {
  console.log(sums(n, 0.5).join(), sums(n, 2).join(), halves(n).join(), negative(n), untouched(n));
  if (n) console.log(grown(n), nan(n), matrix(n).map(row => row.map(x => x.toFixed(3)).join()).join("|"));
  console.log(mixed(n, "x"), mixed(n, null), mixed(n, { valueOf: () => 3 }));
}
for (const n of [-1, 1.5, NaN, 2 ** 32, Infinity]) {
  for (const run of [() => sums(n, 0.5), () => halves(n), () => untouched(n)]) {
    try {
      console.log(String(run().length));
    } catch (error) {
      console.log((error as Error).constructor.name);
    }
  }
}
const field = new Field(3, 2);
for (let i = 0; i < 12; i++) field.add(i % 3, i % 2, i / 8);
console.log(field.cells.join(), field.cells.reduce((a, b) => a + b, 0), [...field.cells].sort((a, b) => b - a).join());
let total = 0;
for (let i = 0; i < 2000; i++) {
  const list = sums(20, i / 16);
  total += list[19] + list.length;
}
console.log(total, Object.keys(sums(3, 0.5)).join(), structuredClone(sums(3, 0.25)).join(), sums(3, 0.25).concat(sums(2, 2)).join());
