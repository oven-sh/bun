// Other kinds of storage.
// Sizes: 1000 4000 16000
// Passes: 230
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function add(list: (number | undefined)[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i] ?? 1;
  return s;
}
function once(): string {
  const holes: (number | undefined)[] = [];
  for (let i = 0; i < size * 8; i += 2) holes[i] = i & 63;
  const fractions: number[] = [];
  for (let i = 0; i < size * 8; i++) fractions.push(i / 4);
  return [add(holes), add(fractions)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
