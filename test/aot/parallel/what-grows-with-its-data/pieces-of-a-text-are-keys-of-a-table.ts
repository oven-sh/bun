// A piece is hashed by its own units.
// Sizes: 1000 4000 16000
// Passes: 92
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function note(table: Map<string, number>, text: string, from: number, to: number): void {
  const key = text.slice(from, to);
  table.set(key, (table.get(key) ?? 0) + 1);
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  const table = new Map<string, number>();
  for (let at = 0; at + 5 <= whole.length; at += 5) note(table, whole, at, at + 5);
  return [table.size, table.get("alpha")].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
