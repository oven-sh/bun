// One `while` that carries SIZE names round, with `if (..) y = x_k; x_k = ..;` for each: along one chain of SIZE blocks where ways meet, one more of the head's own parameters meets in `y` at each.
// The note of a record says which of them meet in it by one bit for each parameter's place in the head: as lists of names the notes held SIZE x SIZE / 2 names, each asked for before it was added.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const given = JSON.parse("[3,0]");'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n, mask) {`, "  let y = 0, sum = 0, r = 0;");
  for (let at = 0; at < size; at++) out.push(`  let x${at} = 0;`);
  out.push("  while (r < n) {", "    r++;");
  for (let at = 0; at < size; at++) out.push(`    if ((r + ${at}) & mask) y = x${at}; x${at} = (x${at} + ${at & 7}) | 0;`);
  out.push("    sum = (sum + r) | 0;", "  }", "  return sum + y;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(given[0] | 0, given[1] | 0)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
