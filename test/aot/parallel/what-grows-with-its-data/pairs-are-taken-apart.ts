// A pattern over each pair of a long list.
// Sizes: 250 1000 4000
// Passes: 1300
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function weigh([count, name]: [number, string]): number {
  return count + name.length;
}
function once(): string {
  const pairs: [number, string][] = [];
  for (let i = 0; i < size * 2; i++) pairs.push([i & 127, "v" + (i & 15)]);
  let sum = 0;
  for (const pair of pairs) sum += weigh(pair);
  for (const [count, name] of pairs) sum += count - name.length;
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
