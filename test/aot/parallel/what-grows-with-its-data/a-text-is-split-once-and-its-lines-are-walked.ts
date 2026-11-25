// One split of the whole, then work on each line.
// Sizes: 1000 4000 16000
// Passes: 140
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function weigh(text: string): number {
  const cut = text.indexOf(",");
  return cut + text.length + text.trim().length + text.toUpperCase().charCodeAt(0);
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let seen = 0;
  for (const one of whole.split("\n")) seen += weigh(one);
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
