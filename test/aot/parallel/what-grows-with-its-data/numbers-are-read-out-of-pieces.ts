// parseInt, Number and unary plus on pieces.
// Sizes: 1000 4000 16000
// Passes: 190
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function read(text: string, from: number, to: number): number {
  const piece = text.slice(from, to);
  return parseInt(piece, 10) + Number(piece.slice(5, 9)) + +piece.slice(10, 12);
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify("1204 77.5 -3 0x1f 9e2\n".repeat(size)));
  let at = 0,
    sum = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    sum += read(whole, at, end);
    at = end + 1;
  }
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
