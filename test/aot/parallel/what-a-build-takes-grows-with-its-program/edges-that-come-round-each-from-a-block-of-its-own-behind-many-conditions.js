// One `while` with SIZE times `if (..) y = ..;` and then SIZE times `if (..) { if (..) y = k; continue; }`: SIZE edges come round, each out of a block of its own where ways meet, and all of those
// stand on one chain of SIZE such blocks. The look for the head's own parameters that meet in what comes round gives every record that it went through a note, so the chain is gone through once.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const given = JSON.parse("[3,0]");'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n, mask) {`, "  let y = 0, sum = 0, r = 0;", "  while (r < n) {", "    r++;");
  for (let at = 0; at < size; at++) out.push(`    if ((r + ${at}) & mask) y = (y + ${at & 7}) | 0;`);
  for (let at = 0; at < size; at++) out.push(`    if ((r ^ ${at}) & mask) { if ((r + ${at}) & mask) y = ${at & 7}; continue; }`);
  out.push("    sum = (sum + r) | 0;", "  }", "  return sum + y;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(given[0] | 0, given[1] | 0)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
