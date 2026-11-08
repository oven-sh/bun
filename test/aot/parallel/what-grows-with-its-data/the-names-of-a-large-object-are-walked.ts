// for-in, keys, values, entries: once each.
// Sizes: 250 1000 4000
// Passes: 360
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

function once(): string {
  const bag: Record<string, number> = {};
  for (let i = 0; i < size * 2; i++) bag["name" + i] = i & 15;
  let a = 0;
  for (const name in bag) a += bag[name]!;
  let b = 0;
  for (const name of Object.keys(bag)) b += name.length;
  let c = 0;
  for (const value of Object.values(bag)) c += value;
  let d = 0;
  for (const [name, value] of Object.entries(bag)) d += name.length + value;
  return [a, b, c, d].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
