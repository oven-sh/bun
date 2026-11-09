// By index, for-of, forEach and entries.
// Sizes: 1000 4000 16000
// Passes: 58
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function byIndex(list: number[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i]!;
  return s;
}
function byOf(list: number[]): number {
  let s = 0;
  for (const x of list) s += x;
  return s;
}
function byEach(list: number[]): number {
  let s = 0;
  list.forEach(x => {
    s += x;
  });
  return s;
}
function byEntries(list: number[]): number {
  let s = 0;
  for (const [i, x] of list.entries()) s += x + (i & 1);
  return s;
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  return [byIndex(numbers), byOf(numbers), byEach(numbers), byEntries(numbers)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
