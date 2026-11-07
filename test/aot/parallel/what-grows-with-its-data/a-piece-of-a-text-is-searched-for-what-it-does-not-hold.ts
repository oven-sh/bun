// indexOf, includes and lastIndexOf on a piece.
// Sizes: 1000 4000 16000
// Passes: 150
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function look(text: string, from: number, to: number): number {
  const piece = text.slice(from, to);
  return piece.indexOf(";") + (piece.includes("#") ? 1 : 0) + piece.lastIndexOf("?") + piece.indexOf("zeta");
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    seen = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    seen += look(whole, at, end);
    at = end + 1;
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
