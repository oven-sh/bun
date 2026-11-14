// Indexes that step beside a counter, or that the counter replaces. Before the unrolled iterations the greatest index is checked against the length.
function smooth(x: number[], y: number[], width: number, row: number, rowSize: number): void {
  let last = (row - 1) * rowSize;
  let current = row * rowSize;
  let next = (row + 1) * rowSize;
  let carried = x[current];
  ++current;
  for (let i = 1; i <= width; i++) carried = x[current] = (y[current] + 0.25 * (carried + x[++current] + x[++last] + x[++next])) * 0.5;
}
function differences(u: number[], v: number[], out: number[], count: number, from: number): void {
  let before = from - 1;
  let at = from;
  let behind = from + 1;
  for (let i = 0; i < count; i++) out[at++] = v[++before] - 0.5 * (u[behind++] - u[before]);
}
function copyRow(from: number[], to: number[], count: number, at: number): void {
  for (let i = 0; i < count; i++) {
    to[at] = from[at];
    ++at;
  }
}
function strided(x: number[], y: number[], count: number, at: number, step2: number): void {
  let p = at;
  let q = step2;
  for (let i = 0; i < count; i++) {
    y[q] = x[p] * 2 + i;
    p += 2;
    q += 3;
  }
}
function backward(x: number[], y: number[], count: number, at: number): void {
  for (let i = 0; i < count; i++) {
    y[i] = x[at] + x[at - 1];
    at--;
  }
}
function sorted(list: number[]): number[] {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let j = i + 1; j < n; j++) if (list[j] < list[m]) m = j;
    const t = list[i];
    list[i] = list[m];
    list[m] = t;
  }
  return list;
}
function smallest(list: number[], n: number, m: number): number {
  for (let j = 0; j < n; j++) if (list[j] < list[m]) m = j;
  return m;
}
function greatest(list: number[], other: number[], n: number, m: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (list[j] >= other[m]) m = j;
    sum += other[m];
  }
  return sum * 100 + m;
}
const size = 40;
const doubles = (): number[] => Array.from({ length: size }, (_, i) => ((i * 7) % 13) / 4);
const ints = (): number[] => Array.from({ length: size }, (_, i) => (i * 11) % 17);
const holes = (): number[] => {
  const list = doubles();
  delete list[7];
  delete list[23];
  return list;
};
const holedInts = (): number[] => {
  const list = ints();
  delete list[5];
  return list;
};
const short = (): number[] => doubles().slice(0, 21);
const shortInts = (): number[] => ints().slice(0, 19);
const strange = (): number[] => [NaN, -0, 0, Infinity, -Infinity, 1e300, 5e-324, 2 ** 31, -(2 ** 31), 2 ** 53, NaN, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const makes = [doubles, ints, holes, holedInts, short, shortInts, strange];
const lines: string[] = [];
const say = (label: string, list: number[]) => lines.push(label + " " + list.length + " " + list.map(String).join(" "));
for (const make of makes) {
  for (const other of makes) {
    for (const [width, row, rowSize] of [[8, 1, 10], [10, 2, 8], [17, 1, 12], [3, 1, 5], [0, 1, 10], [25, 0, 10], [12, 1.5, 10]]) {
      const x = make();
      smooth(x, other(), width, row, rowSize);
      say("smooth", x);
    }
    const shared = make();
    smooth(shared, shared, 9, 1, 11);
    say("shared", shared);
    for (const [count, from] of [[10, 1], [18, 3], [30, 5], [39, 1], [8, 36], [5, 0], [9, -2], [4, 0.5]]) {
      const out = other();
      differences(make(), other(), out, count, from);
      say("differences", out);
      const to = other();
      copyRow(make(), to, count, from);
      say("copy", to);
      const y = other();
      strided(make(), y, count, from, 2);
      say("strided", y);
      const z = make();
      backward(other(), z, count, from + 20);
      say("backward", z);
    }
    for (const [n, m] of [[size, 0], [16, 3], [9, 39], [12, 45], [20, -1], [21, 0.5], [60, 2], [3, 1]]) lines.push([smallest(make(), n, m), greatest(make(), other(), n, m)].join(" "));
  }
  say("sorted", sorted(make()));
}
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines.filter((_, i) => i % 41 === 0).map(line => line.slice(0, 150)).join("\n"));
