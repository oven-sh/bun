// A product is added to an element that may be a hole: the hole is undefined there, and the sum is NaN.
function addScaled(row: number[], other: number[], factor: number, count: number): string {
  for (let j = 0; j < count; j++) row[j] += factor * other[j];
  return row.join();
}
function takeAway(row: number[], other: number[], factor: number, count: number): string {
  for (let j = 0; j < count; j++) row[j] = row[j] - other[j] * factor;
  return row.join();
}
function sumOfBoth(row: number[], other: number[], factor: number, count: number): number {
  let sum = 0;
  for (let j = 0; j < count; j++) sum += row[j] + other[j] / factor;
  return sum;
}
function addTexts(row: any[], other: any[], factor: any, count: number): string {
  for (let j = 0; j < count; j++) row[j] += factor * other[j];
  return row.map(String).join();
}
function join(row: any[], other: any[], count: number): string {
  for (let j = 0; j < count; j++) row[j] += other[j];
  return row.map(String).join();
}
function product(a: number[][], b: number[][]): string {
  const n = a.length;
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n).fill(0);
    for (let k = 0; k < n; k++) {
      const factor = a[i][k];
      for (let j = 0; j < n; j++) row[j] += factor * b[k][j];
    }
    result.push(row);
  }
  return result.map(row => row.join()).join("|");
}
const doubles = () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const ints = () => [1, 2, 3, 4, 5, 6];
const holed = () => { const list = doubles(); delete list[2]; return list; };
const holedInts = () => { const list = ints(); delete list[4]; return list; };
for (const make of [doubles, ints, holed, holedInts]) {
  for (const other of [doubles, ints, holed, holedInts]) {
    console.log(addScaled(make(), other(), 2, 6), takeAway(make(), other(), 0.5, 6), sumOfBoth(make(), other(), 4, 6), sumOfBoth(make(), other(), 4, 2));
  }
  console.log(addScaled(make(), doubles(), NaN, 3), addScaled(make(), ints(), 2, 8), addTexts(make(), ["1", "x", { valueOf: () => 3 }, null, undefined, true], 2, 6));
  console.log(join(make(), ["a", "b", "c", "d", "e", "f"], 6), join(make(), doubles(), 6));
  try {
    console.log(addTexts(make(), [1n, 2n, 3n], 2, 3));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
let asked = 0;
const watched = [1, 2, { valueOf() { asked++; return 7; } }] as any[];
console.log(addTexts(holed(), watched, 1.5, 3), asked);
console.log(product([[1, 2], [3, 4]], [[0.5, 1], [1.5, 2]]), product([[1.5, 2], [3, 4]], [holed(), holedInts()]));
