// split of which one part is read, and one with a limit. The text is proven by a test.
// Sizes: 1000 4000 16000
// Passes: 110
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const unseen = (x: any): any => [x][JSON.parse("0")];
function ask(value: unknown, a: unknown, b: unknown): number {
  const whole = typeof value === "string" ? value : "no";
  const from = typeof a === "number" ? a | 0 : 0,
    to = typeof b === "number" ? b | 0 : 0;
  return whole.slice(from, to).split(",")[0]!.length + whole.slice(from, to).split(";", 1)[0]!.length;
}
const run: typeof ask = unseen(ask);
const line = "alpha,beta,gamma,delta\n";
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    seen = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    seen += run(whole, at, end);
    at = end + 1;
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
