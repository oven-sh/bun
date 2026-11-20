// An async function makes SIZE values, one in front of each of SIZE awaits, and reads them all behind the last: across the k-th await k values are alive.
// What an await saves, and what the tables say of it, must not make a square of that.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 500 1000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["const make = tag => JSON.parse(JSON.stringify({ tag }));", "const settled = Promise.resolve(0);"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`async function steps${copy}() {`);
  for (let at = 0; at < size; at++) out.push(`  const v${at} = make(${at});`, "  await settled;");
  out.push("  let sum = 0;");
  for (let at = 0; at < size; at++) out.push(`  sum = (sum * 31 + v${at}.tag) | 0;`);
  out.push("  return sum;", "}");
}
for (let copy = 0; copy < copies; copy++) out.push(`console.log(await steps${copy}());`);
console.log(out.join("\n"));
