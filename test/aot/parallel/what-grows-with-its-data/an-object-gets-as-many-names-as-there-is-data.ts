// A dictionary by names made at run time.
// Sizes: 250 1000 4000
// Passes: 250
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function put(bag: Record<string, number>, name: string, value: number): void {
  bag[name] = value;
}
function once(): string {
  const bag: Record<string, number> = {};
  for (let i = 0; i < size * 2; i++) put(bag, "name" + i, i & 63);
  let sum = 0;
  for (let i = 0; i < size * 2; i++) sum += bag["name" + i]!;
  return [sum, "name7" in bag, Object.hasOwn(bag, "none")].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
