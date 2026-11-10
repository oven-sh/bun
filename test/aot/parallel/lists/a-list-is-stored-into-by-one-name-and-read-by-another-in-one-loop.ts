class Holder {
  a: any[] = [];
  constructor(size: number) { for (let i = 0; i < size; i++) this.a.push(i & 3); }
  run(n: number): number {
    let c = 0;
    for (let i = 0; i < n; i++) { this.a[i] = 0; if (this.a[i + 1] === 2) c++; }
    return c;
  }
}
class Box {
  list: number[] = [];
  constructor(size: number) { for (let i = 0; i < size; i++) this.list.push(i); }
}
function run(box: Box): number {
  const list = box.list;
  let sum = 0;
  for (let i = 0; i < list.length; i++) { list[i] = i & 7; sum += box.list[(i + 3) & 15]!; }
  return sum;
}
function rows(grid: unknown[][], y: number): number {
  const row = grid[y]!;
  let seen = 0;
  for (let x = 0; x < row.length; x++) { row[x] = 1; if (grid[y]![(x + 1) % row.length] === 1) seen++; }
  return seen;
}
const holder = new Holder(40);
let counted = 0;
for (let turn = 0; turn < 20; turn++) counted += holder.run(30);
const box = new Box(48);
let acc = 0;
for (let turn = 0; turn < 20; turn++) acc += run(box);
const grid: unknown[][] = [["a", "b", "c", "d"], [1, 2, 3, 4], [0.5, 1.5, 2.5, 3.5]];
let all = 0;
for (let turn = 0; turn < 20; turn++) for (let y = 0; y < 3; y++) all += rows(grid, y);
console.log("SAID", counted, acc, all, JSON.stringify(holder.a.slice(0, 6)), JSON.stringify(box.list.slice(0, 10)), JSON.stringify(grid));
