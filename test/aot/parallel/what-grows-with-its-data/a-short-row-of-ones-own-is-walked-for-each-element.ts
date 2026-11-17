// For each element a short row with an iterator of its own is walked by for-of: to its end, left early, one in another, and in an async function that awaits behind the loop.
// Sizes: 1000 4000 16000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
class Row {
  constructor(
    readonly from: number,
    readonly count: number,
  ) {}
  [Symbol.iterator]() {
    let at = 0;
    const row = this;
    return {
      next() {
        return at < row.count ? { done: false, value: row.from + at++ } : { done: true, value: 0 };
      },
    };
  }
}
function whole(row: Row): number {
  let sum = 0;
  for (const x of row) sum = (sum + x) | 0;
  return sum;
}
function untilOver(row: Row, limit: number): number {
  for (const x of row) if (x > limit) return x;
  return -1;
}
function pairs(outer: Row, inner: Row): number {
  let sum = 0;
  for (const a of outer) for (const b of inner) sum = (sum + a * b) | 0;
  return sum;
}
async function thenWaits(row: Row): Promise<number> {
  let sum = 0;
  for (const x of row) sum = (sum + x) | 0;
  await null;
  return sum;
}
async function once(): Promise<string> {
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const row = new Row(i & 7, 3);
    sum = (sum + whole(row) + untilOver(row, 2) + pairs(row, row)) | 0;
    if ((i & 15) === 0) sum = (sum + (await thenWaits(row))) | 0;
  }
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = await once();
console.log(told);
