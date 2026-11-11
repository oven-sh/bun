// One `while` with SIZE times `if (..) y = ..; if (..) continue;`: SIZE edges come round, each behind one more block where ways meet. Both looks at what comes round (what stands beside the parameter,
// and which of the head's own parameters meet in it) note what they found by the record they began at: the look at the next edge asks the note of the edge in front.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const given = JSON.parse("[3,0]");'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n, mask) {`, "  let y = 0, sum = 0, r = 0;", "  while (r < n) {", "    r++;");
  for (let at = 0; at < size; at++) out.push(`    if ((r + ${at}) & mask) y = (y + ${at & 7}) | 0; if ((r ^ ${at}) & mask) continue;`);
  out.push("    sum = (sum + r) | 0;", "  }", "  return sum + y;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(given[0] | 0, given[1] | 0)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
