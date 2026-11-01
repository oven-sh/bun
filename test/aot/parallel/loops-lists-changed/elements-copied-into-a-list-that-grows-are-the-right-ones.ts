// Elements of a typed array go into a list, one or two a turn. The list has to grow every so often, and the loop goes on behind that turn where it was: with the next
// element, not with the first one again, whichever way it counts: up, down, by rows, by threes, from both ends, tested above or below, with a neighbor or the one before.
function up(from: Uint16Array, n: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < n; i++) list.push(from[i]!);
  return list;
}
function down(from: Uint16Array): number[] {
  const list: number[] = [];
  for (let i = from.length - 1; i >= 0; i--) list.push(from[i]!);
  return list;
}
function testedBelow(from: Uint16Array, n: number): number[] {
  const list: number[] = [];
  let i = 0;
  do list.push(from[i]!);
  while (++i < n);
  return list;
}
function downTestedBelow(from: Uint16Array): number[] {
  const list: number[] = [];
  let i = from.length - 1;
  do list.push(from[i]!);
  while (--i >= 0);
  return list;
}
function byThrees(from: Uint16Array, n: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < n; i += 3) list.push(from[i]!);
  return list;
}
function column(from: Uint16Array, width: number, height: number, at: number): number[] {
  const list: number[] = [];
  for (let row = 0; row < height; row++) list.push(from[row * width + at]!);
  return list;
}
function columnUpwards(from: Uint16Array, width: number, at: number): number[] {
  const list: number[] = [];
  for (let row = ((from.length / width) | 0) - 1; row >= 0; row--) list.push(from[row * width + at]!);
  return list;
}
function twoColumns(from: Uint16Array, width: number, height: number): number[] {
  const list: number[] = [];
  for (let row = 0; row < height; row++) list.push(from[row * width]! * 3 + from[row * width + width - 1]!);
  return list;
}
function fromBothEnds(from: Uint16Array): number[] {
  const list: number[] = [];
  let low = 0;
  let high = from.length - 1;
  while (low < high) list.push(from[low++]! * 3 + from[high--]!);
  return list;
}
function withNeighbors(from: Uint16Array, n: number): number[] {
  const list: number[] = [];
  for (let i = 1; i < n - 1; i++) list.push(from[i - 1]! * 3 + from[i + 1]!);
  return list;
}
function withTheOneBefore(from: Uint16Array, n: number): number[] {
  const list: number[] = [];
  let before = 0;
  for (let i = 1; i < n; i++) {
    list.push(from[before]! * 3 + from[i]!);
    before = i;
  }
  return list;
}
function fromTheMiddleOn(from: Uint16Array): number[] {
  const list: number[] = [];
  for (let i = from.length >> 2; i < from.length; i++) list.push(from[i]!);
  return list;
}

function digest(list: number[]): string {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum = (sum * 31 + list[i]!) % 1000003;
  return list.length + ":" + sum;
}
const loops: Record<string, (from: Uint16Array, n: number) => number[]> = {
  up,
  down,
  testedBelow,
  downTestedBelow,
  byThrees,
  column: (from, n) => column(from, 4, n >> 2, 1),
  columnUpwards: from => columnUpwards(from, 4, 3),
  wideColumn: (from, n) => column(from, 7, (n / 7) | 0, 5),
  twoColumns: (from, n) => twoColumns(from, 5, (n / 5) | 0),
  fromBothEnds,
  withNeighbors,
  withTheOneBefore,
  fromTheMiddleOn,
};
for (const name in loops) {
  const row: string[] = [];
  for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 33, 64, 100, 257, 1000, 5000]) {
    const from = new Uint16Array(n);
    for (let i = 0; i < n; i++) from[i] = (i * 2654435761) >>> 17;
    row.push(digest(loops[name]!(from, n)));
  }
  console.log(name, row.join(" "));
}
