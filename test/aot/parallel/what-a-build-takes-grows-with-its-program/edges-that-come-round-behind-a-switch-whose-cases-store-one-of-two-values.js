// One `while` with a `switch` of SIZE cases that each store one of two values into `y`, and then SIZE times `if (..) continue;`: SIZE edges come round, and each look at what they bring goes over the
// SIZE edges into the block behind the switch, though it reaches four records in all. Whether a look is worth a note is judged by the steps it took, not by the records it reached.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const given = JSON.parse("[3,0,5,6]");'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n, mask, a, b) {`, "  let y = 0, sum = 0, r = 0;", "  while (r < n) {", "    r++;", "    switch ((r + mask) | 0) {");
  for (let at = 0; at < size; at++) out.push(`      case ${at + 10}: y = ${at & 1 ? "a" : "b"}; break;`);
  out.push("    }");
  for (let at = 0; at < size; at++) out.push(`    if ((r ^ ${at}) & mask) continue;`);
  out.push("    sum = (sum + r) | 0;", "  }", "  return sum + y;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(given[0] | 0, given[1] | 0, given[2] | 0, given[3] | 0)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
