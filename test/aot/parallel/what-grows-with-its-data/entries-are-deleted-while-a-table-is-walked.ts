// The walk goes on past what has gone.
// Sizes: 250 1000 4000
// Passes: 1000
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

function once(): string {
  const table = new Map<number, string>();
  for (let i = 0; i < size * 2; i++) table.set(i, "v" + (i & 7));
  let seen = 0;
  for (const [key, value] of table) {
    seen += value.length;
    if (key & 1) table.delete(key);
    else if (key + 1 < size * 2) table.delete(key + 1);
  }
  return [seen, table.size].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
