// Loops that count over a typed array, a list or a text: up, down, by rows, from both ends, tested above or below. A path that is seldom taken (a getter of one object among
// thousands, a list that has to grow) makes the array shorter or longer, takes its buffer away, replaces the list or moves the bound. The turns behind it must see the change,
// wherever the path is taken: in the first turn, the last, two turns in a row, every few turns.
type Item = { weight: number };
type Bound = { count: number };
const out: string[] = [];

let change: () => void = () => {};
function itemsOf(n: number, seldom: number[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ weight: (i & 3) + 1 });
  for (const at of seldom) {
    if (at >= 0 && at < n) {
      items[at] = {
        get weight() {
          change();
          return 9;
        },
      };
    }
  }
  return items;
}
function bytesOf(n: number): Uint8Array {
  const bytes = new Uint8Array(new ArrayBuffer(n, { maxByteLength: 4 * n + 64 }));
  for (let i = 0; i < n; i++) bytes[i] = (i * 7) & 255;
  return bytes;
}
function read(value: number | undefined): number {
  return value === undefined ? 1000 : value;
}

function countsUp(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 3 + read(bytes[i]) + items[i]!.weight) % 1000003;
  return sum;
}
function countsUpToLength(bytes: Uint8Array, items: Item[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum * 3 + read(bytes[i]) + items[i]!.weight) % 1000003;
  return sum;
}
function countsUpToField(bytes: Uint8Array, items: Item[], bound: Bound): number {
  let sum = 0;
  for (let i = 0; i < bound.count; i++) sum = (sum * 3 + read(bytes[i]) + items[i]!.weight) % 1000003;
  return sum;
}
function countsDown(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) sum = (sum * 3 + read(bytes[i]) + items[i]!.weight) % 1000003;
  return sum;
}
function testedBelow(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  let i = 0;
  do sum = (sum * 3 + read(bytes[i]) + items[i]!.weight) % 1000003;
  while (++i < n);
  return sum;
}
function goesOnBehindTheTest(bytes: Uint8Array, items: Item[], bound: Bound): number {
  let sum = 0;
  let i = 0;
  for (;;) {
    sum = (sum * 3 + read(bytes[i])) % 1000003;
    if (!(++i < bound.count)) break;
    sum = (sum + items[i]!.weight) % 1000003;
  }
  return sum;
}
function byRows(bytes: Uint8Array, items: Item[], width: number, height: number, column: number): number {
  let sum = 0;
  for (let row = 0; row < height; row++) sum = (sum * 3 + read(bytes[row * width + column]) + items[row]!.weight) % 1000003;
  return sum;
}
function byRowsDownwards(bytes: Uint8Array, items: Item[], width: number, height: number, column: number): number {
  let sum = 0;
  for (let row = height - 1; row >= 0; row--) sum = (sum * 3 + read(bytes[row * width + column]) + items[row]!.weight) % 1000003;
  return sum;
}
function fromBothEnds(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  let low = 0;
  let high = n - 1;
  while (low < high) {
    sum = (sum * 3 + items[low]!.weight) % 1000003;
    sum = (sum + read(bytes[low++]) * 5 + read(bytes[high--])) % 1000003;
  }
  return sum;
}
function withNeighbors(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  for (let i = 1; i < n - 1; i++) sum = (sum * 3 + read(bytes[i - 1]) + read(bytes[i + 1]) * 2 + items[i]!.weight) % 1000003;
  return sum;
}
function withTheOneBefore(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  let before = 0;
  for (let i = 1; i < n; i++) {
    sum = (sum * 3 + read(bytes[before]) + items[i]!.weight) % 1000003;
    before = i;
  }
  return sum;
}
function byThrees(bytes: Uint8Array, items: Item[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i += 3) sum = (sum * 3 + read(bytes[i]) + items[i]!.weight) % 1000003;
  return sum;
}
function overAList(list: number[], items: Item[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 3 + read(list[i]) + items[i]!.weight) % 1000003;
  return sum;
}
function overAText(text: string, items: Item[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 3 + (text.charCodeAt(i) | 0) + items[i]!.weight) % 1000003;
  return sum;
}

// The list that takes the results has to grow now and then, and nothing else happens.
function kept(bytes: Uint8Array, n: number): number {
  const list: number[] = [];
  for (let i = 0; i < n; i++) list.push(read(bytes[i]));
  const back: number[] = [];
  for (let i = n - 1; i >= 0; i--) back.push(read(bytes[i]));
  const folded: number[] = [];
  let low = 0;
  let high = n - 1;
  while (low < high) folded.push(read(bytes[low++]) + read(bytes[high--]));
  const below: number[] = [];
  let k = 0;
  do below.push(read(bytes[k]));
  while (++k < n);
  let sum = 0;
  for (const each of [list, back, folded, below]) for (let i = 0; i < each.length; i++) sum = (sum * 31 + each[i]! + each.length) % 1000003;
  return sum;
}

const size = 300;
const places: number[][] = [[], [0], [1], [2], [size - 1], [size - 2], [0, 1], [5, 6], [5, 6, 7], [5, 7, 9, 11], [40, 41, 90], [0, size - 1]];
const every16: number[] = [];
for (let i = 3; i < size; i += 16) every16.push(i);
places.push(every16);

type Change = [string, (bytes: Uint8Array, list: number[], bound: Bound) => void];
const changes: Change[] = [
  ["nothing", () => {}],
  ["shorter", bytes => (bytes.buffer as ArrayBuffer).resize(Math.max(0, bytes.length - 37))],
  ["much shorter", bytes => (bytes.buffer as ArrayBuffer).resize(Math.min(bytes.length, 4))],
  ["empty", bytes => (bytes.buffer as ArrayBuffer).resize(0)],
  ["longer", bytes => (bytes.buffer as ArrayBuffer).resize(Math.min(bytes.length + 50, (bytes.buffer as ArrayBuffer).maxByteLength))],
  ["gone", bytes => void ((bytes.buffer as ArrayBuffer).detached || (bytes.buffer as ArrayBuffer).transfer())],
  ["list cut", (_, list) => void (list.length = list.length >> 1)],
  ["list grows", (_, list) => void list.push(1, 2, 3, 4, 5, 6, 7, 8, 9)],
  ["list of fractions", (_, list) => void (list[1] = 0.5)],
  ["bound lower", (_, __, bound) => void (bound.count = Math.max(1, bound.count - 60))],
  ["bound higher", (_, __, bound) => void (bound.count = Math.min(size, bound.count + 20))],
];

for (const [name, apply] of changes) {
  for (const seldom of places) {
    const row: number[] = [];
    const run = (n: number, loop: (bytes: Uint8Array, list: number[], items: Item[], bound: Bound) => number) => {
      const bytes = bytesOf(n);
      const list: number[] = [];
      for (let i = 0; i < n; i++) list.push((i * 5) & 63);
      const bound = { count: n - 30 };
      change = () => apply(bytes, list, bound);
      row.push(loop(bytes, list, itemsOf(4 * size + 64, seldom), bound));
    };
    for (const n of [size, size - 20]) {
      run(n, (bytes, _, items) => countsUp(bytes, items, size));
      run(n, (bytes, _, items) => countsUpToLength(bytes, items));
      run(n, (bytes, _, items, bound) => countsUpToField(bytes, items, bound));
      run(n, (bytes, _, items) => countsDown(bytes, items, size));
      run(n, (bytes, _, items) => testedBelow(bytes, items, size));
      run(n, (bytes, _, items, bound) => goesOnBehindTheTest(bytes, items, bound));
      run(n, (bytes, _, items) => byRows(bytes, items, 4, size >> 2, 1));
      run(n, (bytes, _, items) => byRowsDownwards(bytes, items, 4, size >> 2, 3));
      run(n, (bytes, _, items) => fromBothEnds(bytes, items, size));
      run(n, (bytes, _, items) => withNeighbors(bytes, items, size));
      run(n, (bytes, _, items) => withTheOneBefore(bytes, items, size));
      run(n, (bytes, _, items) => byThrees(bytes, items, size));
      run(n, (_, list, items) => overAList(list, items, size));
      run(n, (_, __, items) => overAText("abcdefghij".repeat(n / 10), items, size));
    }
    out.push(`${name} at ${seldom.length > 6 ? "every sixteenth" : seldom.join(" ")}: ${row.join(" ")}`);
  }
}
for (const n of [1, 2, 3, 4, 5, 8, 9, 17, 33, 100, 1000]) out.push(`kept ${n}: ${kept(bytesOf(n), n)} ${kept(bytesOf(n), n + 3)} ${kept(bytesOf(n + 3), n)}`);
console.log(out.join("\n"));
