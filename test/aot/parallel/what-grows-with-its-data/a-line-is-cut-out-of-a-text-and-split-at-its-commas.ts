// The same where each line holds the separator.
// Sizes: 1000 4000 16000
// Passes: 150
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function fieldsOf(text: string, from: number, to: number): number {
  const parts = text.slice(from, to).split(",");
  return parts.length + parts[1]!.length + parts[3]!.length;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    seen = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    seen += fieldsOf(whole, at, end);
    at = end + 1;
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
