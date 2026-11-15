// A piece becomes a property name.
// Sizes: 1000 4000 16000
// Passes: 100
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function note(tally: Record<string, number>, text: string, from: number, to: number): void {
  const key = text.slice(from, to);
  tally[key] = (tally[key] ?? 0) + 1;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  const tally: Record<string, number> = {};
  for (let at = 0; at + 5 <= whole.length; at += 5) note(tally, whole, at, at + 5);
  return [Object.keys(tally).length, tally["alpha"]].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
