// startsWith and endsWith at a place, and a piece held against a written text.
// Sizes: 1000 4000 16000
// Passes: 250
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function kindAt(text: string, at: number): number {
  if (text.startsWith("alpha", at)) return 1;
  if (text.endsWith("delta", at)) return 2;
  return text.slice(at, at + 4) === "beta" ? 3 : 0;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let seen = 0;
  for (let at = 0; at < whole.length; at += 6) seen += kindAt(whole, at);
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
