// test and match on short pieces of a long text.
// Sizes: 1000 4000 16000
// Passes: 140
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function judge(text: string, from: number, to: number): number {
  const piece = text.slice(from, to);
  return (/^alpha,/.test(piece) ? 1 : 0) + (piece.match(/(\w+)$/)?.[1]?.length ?? 0) + (/zeta/.test(piece) ? 100 : 0);
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    seen = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    seen += judge(whole, at, end);
    at = end + 1;
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
