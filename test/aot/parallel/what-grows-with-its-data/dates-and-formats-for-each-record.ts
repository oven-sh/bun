// A Date and its ISO text for each record; toFixed, toString(16), padStart.
// Sizes: 1000 4000 16000
// Passes: 42
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function stamp(i: number): number {
  const at = new Date(1700000000000 + i * 60000);
  return at.toISOString().length + at.getUTCDay() + (i / 7).toFixed(2).length + i.toString(16).padStart(8, "0").length;
}
function once(): string {
  let sum = 0;
  for (let i = 0; i < size * 2; i++) sum += stamp(i);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
