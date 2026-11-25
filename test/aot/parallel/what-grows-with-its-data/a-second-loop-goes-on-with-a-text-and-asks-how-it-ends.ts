// One loop gathers a text and a second loop goes on with it, looking at its end at each turn. The long text that enters the second loop may not be put together anew at every look.
// Sizes: 1000 4000 16000
// Passes: 150
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function gather(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += "row" + (i & 7) + ",";
  for (let i = 0; i < count; i++) {
    if (out.length > 0 && !out.endsWith(",")) out += ";";
    out += (i & 3) === 3 ? "ab," : "cd";
  }
  return out;
}
function once(): string {
  const text = gather(size);
  return text.length + text.slice(-12);
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
