// replaceAll with a text and replace with a function, once over the text.
// Sizes: 1000 4000 16000
// Passes: 99
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function swap(text: string): string {
  return text.replaceAll(",", ";").replace(/gamma/g, found => found.toUpperCase());
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  const out = swap(whole);
  return [out.length, out.indexOf("GAMMA"), out.lastIndexOf(";")].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
