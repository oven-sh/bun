// exec in a loop, and matchAll.
// Sizes: 1000 4000 16000
// Passes: 45
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha,beta,gamma,delta\n";
function count(text: string): number {
  const word = /[a-z]+/g;
  let n = 0;
  while (word.exec(text)) n++;
  return n;
}
function lengths(text: string): number {
  let n = 0;
  for (const found of text.matchAll(/(\w)\w*,/g)) n += found[1]!.length + (found.index! % 3);
  return n;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  return [count(whole), lengths(whole)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
