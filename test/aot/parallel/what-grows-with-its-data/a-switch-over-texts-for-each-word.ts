// Written cases against pieces and ropes.
// Sizes: 1000 4000 16000
// Passes: 49
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function kind(word: string): number {
  switch (word) {
    case "alpha":
      return 1;
    case "beta":
      return 2;
    case "gamma":
      return 3;
    case "delta":
      return 4;
    case "":
      return 5;
    default:
      return 0;
  }
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let sum = 0,
    from = 0;
  for (let at = 0; at < whole.length; at++) {
    const unit = whole.charCodeAt(at);
    if (unit === 44 || unit === 10) {
      sum += kind(whole.slice(from, at)) + kind("al" + whole.slice(from + 2, at));
      from = at + 1;
    }
  }
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
