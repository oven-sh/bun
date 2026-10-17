// An array that falls is seen to fall, as one that rises is seen to rise: the comparator is asked once for each pair of neighbors.
// What falls only in parts, or falls with ties, comes out in the one order that a stable sort has.
class Rec {
  constructor(
    public key: number,
    public index: number,
  ) {}
}

function questionsAboutNumbers(values: number[]): string {
  let asked = 0;
  const sorted = values.slice().sort((a, b) => {
    asked++;
    return a - b;
  });
  let askedForCopy = 0;
  const copy = values.toSorted((a, b) => {
    askedForCopy++;
    return a - b;
  });
  for (let i = 1; i < sorted.length; i++) if (sorted[i - 1] > sorted[i] || copy[i] !== sorted[i]) return "out of order";
  return `${asked} ${askedForCopy}`;
}

function questionsAboutRecords(values: Rec[]): string {
  let asked = 0;
  const sorted = values.slice().sort((a, b) => {
    asked++;
    return a.key - b.key;
  });
  let askedForCopy = 0;
  const copy = values.toSorted((a, b) => {
    askedForCopy++;
    return a.key - b.key;
  });
  for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].key > sorted[i].key || copy[i] !== sorted[i]) return "out of order";
  return `${asked} ${askedForCopy}`;
}

for (const length of [8, 9, 15, 16, 17, 24, 25, 64, 100, 1000, 1001]) {
  const falling: number[] = [];
  const fallingByHalves: number[] = [];
  const rising: number[] = [];
  const fallingRecords: Rec[] = [];
  const risingRecords: Rec[] = [];
  for (let i = 0; i < length; i++) {
    falling.push((length - i) * 3);
    fallingByHalves.push((length - i) * 0.5);
    rising.push(i * 3);
    fallingRecords.push(new Rec(length - i, i));
    risingRecords.push(new Rec(i, i));
  }
  console.log(length, questionsAboutNumbers(falling), questionsAboutNumbers(fallingByHalves), questionsAboutNumbers(rising), questionsAboutRecords(fallingRecords), questionsAboutRecords(risingRecords));
}

function orderOf(keys: number[]): string {
  const records: Rec[] = keys.map((key, index) => new Rec(key, index));
  const sorted = records.slice().sort((a, b) => a.key - b.key);
  const copy = records.toSorted((a, b) => a.key - b.key);
  const numbers = keys.slice().sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (copy[i] !== sorted[i] || numbers[i] !== sorted[i].key) return "the three differ";
    sum = (sum * 31 + sorted[i].index) % 1000003;
  }
  return String(sum);
}

let seed = 12345;
function next(limit: number): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed % limit;
}

const shapes: [string, (i: number, length: number) => number][] = [
  ["falls with ties", (i, length) => (length - i) >> 1],
  ["falls with many ties", (i, length) => (length - i) >> 3],
  ["all the same", () => 7],
  ["falls in runs of five", i => -(i % 5)],
  ["falls in runs of eight", i => -(i % 8)],
  ["falls in runs of nine", i => -(i % 9)],
  ["falls in runs of forty", i => -(i % 40)],
  ["rises, then falls", (i, length) => (i < length / 2 ? i : length - i)],
  ["falls, then rises", (i, length) => (i < length / 2 ? length - i : i)],
  ["falls, but for a few", (i, length) => (next(10) === 0 ? next(length) : length - i)],
  ["falls unsteadily", (i, length) => length - i + next(8)],
  ["blocks that fall, each rising", i => -(i >> 3) * 100 + (i & 7)],
  ["blocks that fall, each with ties", i => -(i >> 3)],
  ["blocks that rise, each falling", i => (i >> 3) * 100 - (i & 7)],
  ["by chance", (_, length) => next(length)],
];
for (const [name, shape] of shapes) {
  const sums: string[] = [];
  for (let length = 0; length <= 70; length++) {
    const keys: number[] = [];
    for (let i = 0; i < length; i++) keys.push(shape(i, length));
    sums.push(orderOf(keys));
  }
  for (const length of [127, 128, 129, 500, 1000, 4097]) {
    const keys: number[] = [];
    for (let i = 0; i < length; i++) keys.push(shape(i, length));
    sums.push(orderOf(keys));
  }
  console.log(name, sums.join(" "));
}

const answersOnlyOneWay: ((a: number, b: number) => any)[] = [(a, b) => a > b, (a, b) => a >= b, (a, b) => (a < b ? -1 : 1), (a, b) => (a > b ? 1 : -1), (a, b) => b - a, (a, b) => b < a];
for (const order of answersOnlyOneWay) {
  const lines: string[] = [];
  for (const length of [2, 3, 8, 9, 17, 33, 100]) {
    const falling: number[] = [];
    for (let i = 0; i < length; i++) falling.push((length - i) >> 1);
    lines.push(falling.slice().sort(order).join(""));
  }
  console.log(lines.join(" ").length, lines[3], lines[4]);
}
