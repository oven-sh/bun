// A search in a piece of a text ends where the piece ends.
// Sizes: 1000 4000 16000
// Passes: 100
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const unseen = (x: any): any => [x][JSON.parse("0")];
function fieldsOf(value: unknown, a: unknown, b: unknown): string {
  const whole = typeof value === "string" ? value : "no";
  const from = typeof a === "number" ? a | 0 : 0,
    to = typeof b === "number" ? b | 0 : 0;
  const parts = whole.slice(from, to).split(";");
  return parts[0] + "|" + parts[1];
}
const run: typeof fieldsOf = unseen(fieldsOf);
const line = "alpha,beta,gamma,delta\n";
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    seen = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    seen += run(whole, at, end).length;
    at = end + 1;
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
