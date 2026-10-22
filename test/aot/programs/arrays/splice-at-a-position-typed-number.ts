// The position and the count of a splice are typed `number` and hold whole numbers, fractions, NaN, infinities, -0, numbers beyond int32: with the result used, unused, and taken apart.
function insertAt(list: number[], at: number, value: number): void { list.splice(at, 0, value); }
function removeAt(list: string[], at: number, count: number): string[] { return list.splice(at, count); }
function replaceAt(list: (string | number)[], at: number, count: number, a: string, b: number): number { const [first] = list.splice(at, count, a, b); return typeof first === "number" ? first : -1; }
function pick(values: number[], i: number): number { let chosen: number; if (i % 3 === 0) chosen = values[i % values.length]; else if (i % 3 === 1) chosen = values[(i * 7) % values.length] / 1; else chosen = i % 5; return chosen; }
const positions = [0, 1, 2, 3.5, -1, -2.5, NaN, Infinity, -Infinity, -0, 2 ** 31, -(2 ** 31) - 1, 2 ** 32 + 1, 1e300, 0.999, 4, 100];
const lines: string[] = [];
for (let round = 0; round < 400; round++) {
  const at = pick(positions, round), count = pick(positions, round + 5);
  const numbers = [1, 2, 3, 4, 5];
  insertAt(numbers, at, 9);
  const texts = ["a", "b", "c", "d", "e", "f"];
  const removed = removeAt(texts, at, count);
  const mixed: (string | number)[] = [1, "x", 2, "y"];
  const first = replaceAt(mixed, at, count, "new", 7);
  if (round < 60 || round % 37 === 0) lines.push([at, count, numbers.join(), texts.join(""), removed.join(""), mixed.join(), first].join(" | "));
}
console.log(lines.join("\n"));
// As in a sorted insertion: the position is a variable without an initial value that two branches fill.
function reorder(items: number[]): number[] {
  const result: number[] = [];
  let special = -1, cutoff = 0, index = 0;
  for (const item of items) {
    let spliceIndex: number;
    if (item % 4 === 0) { special++; spliceIndex = special; cutoff++; } else { index = item % 3 === 0 ? cutoff : index + 1; spliceIndex = Math.min(index, result.length); }
    result.splice(spliceIndex, 0, item);
  }
  return result;
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += reorder([i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6])[i % 7];
console.log(sum, reorder([8, 3, 4, 1, 12, 9, 5, 16]).join());
