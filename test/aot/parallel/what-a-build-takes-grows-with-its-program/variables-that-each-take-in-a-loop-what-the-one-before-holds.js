// SIZE variables of one function hold a function of their own each, and in every turn of one loop each takes what the one before it holds. So the last may hold any of them, the one before it
// all but one, and so on. Which types reach the parameters of the head was found with a list that had no order: the kinds of each earlier variable ran the whole row behind it, one after the
// other, and each step made a set that nobody had seen before: 1,496 | 3,741 | 12,259 M instructions and 165 | 419 | 1,230 MB.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 500 1000 2000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const all = Array.from({ length: size }, (_, at) => at);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(limit: number) {`, `  let ${all.map(at => `x${at} = () => ${at}`).join(", ")};`, "  for (let i = 0; i < limit; i++) {");
  for (let at = size - 1; at > 0; at--) out.push(`    x${at} = x${at - 1};`);
  out.push("  }", `  return ${all.map(at => `x${at}()`).join(" + ")};`, "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told += run${copy}(JSON.parse("3"));`);
out.push("console.log(told);");
console.log(out.join("\n"));
