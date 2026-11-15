// for-of over a text with pairs of surrogates, and codePointAt.
// Sizes: 1000 4000 16000
// Passes: 170
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function weigh(unit: string): number {
  return unit.codePointAt(0)! & 1023;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify("ab\u{1F600}c\u4e2dd".repeat(size)));
  let seen = 0;
  for (const unit of whole) seen = (seen + weigh(unit)) | 0;
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
