// lastIndex says where the next match begins.
// Sizes: 1000 4000 16000
// Passes: 21
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
const word = /[a-z]+/y,
  gap = /[^a-z]+/y;
function next(text: string, at: number): number {
  word.lastIndex = at;
  const found = word.exec(text);
  if (found) return word.lastIndex;
  gap.lastIndex = at;
  return gap.exec(text) ? gap.lastIndex : text.length;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    steps = 0;
  while (at < whole.length) {
    at = next(whole, at);
    steps++;
  }
  return [steps].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
