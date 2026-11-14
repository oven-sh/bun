// delete, one name at a time.
// Sizes: 250 1000 4000
// Passes: 400
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function drop(bag: Record<string, number>, name: string): boolean {
  return delete bag[name];
}
function once(): string {
  const bag: Record<string, number> = {};
  for (let i = 0; i < size * 2; i++) bag["name" + i] = i;
  let gone = 0;
  for (let i = 0; i < size * 2; i += 2) if (drop(bag, "name" + i)) gone++;
  return [gone, Object.keys(bag).length].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
