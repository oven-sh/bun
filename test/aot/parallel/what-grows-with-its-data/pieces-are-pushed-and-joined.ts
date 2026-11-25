// join over a list of texts.
// Sizes: 250 1000 4000
// Passes: 490
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function lineOf(i: number): string {
  return "row " + i + " of " + (i % 7);
}
function once(): string {
  const rows: string[] = [];
  for (let i = 0; i < size * 3; i++) rows.push(lineOf(i));
  const text = rows.join("\n");
  return [text.length, text.charCodeAt(text.length >> 1)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
