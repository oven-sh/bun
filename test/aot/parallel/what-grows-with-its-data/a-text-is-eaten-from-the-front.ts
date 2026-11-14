// rest = rest.slice(n): a piece of a piece of a piece.
// Sizes: 1000 4000 16000
// Passes: 170
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function head(rest: string): number {
  const end = rest.indexOf(",");
  return end < 0 || end > 12 ? rest.indexOf("\n") + 1 : end + 1;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let rest = whole,
    seen = 0;
  while (rest.length > 0) {
    const taken = head(rest);
    if (taken <= 0) break;
    seen += taken;
    rest = rest.slice(taken);
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
