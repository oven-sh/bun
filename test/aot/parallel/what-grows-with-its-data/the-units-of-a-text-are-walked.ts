// charCodeAt, a read by index and at().
// Sizes: 1000 4000 16000
// Passes: 110
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function weigh(text: string, at: number): number {
  return text.charCodeAt(at) + (text[at + 1] === "a" ? 1 : 0) + (text.at(at + 2) === "," ? 2 : 0);
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let seen = 0;
  for (let at = 0; at + 2 < whole.length; at++) seen = (seen + weigh(whole, at)) | 0;
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
