// One `while` that begins with `y = xs.indexOf(..)` and goes on with SIZE times `if (..) y = ..; if (..) continue;`. What a built-in answers in line is a parameter of a block that no edge fills. The look
// at what comes round was cut there and wrote no note, so each of the SIZE looks went down the whole chain again. Such a parameter is an end of the look like any other, with its own type.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const given = JSON.parse("[3,0]");'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n, mask) {`, "  const xs = [9, 9, 9, 9, 9, 9, 9, 0];", "  let y = 0, sum = 0, r = 0;", "  while (r < n) {", "    r++;", "    y = xs.indexOf(r & mask);");
  for (let at = 0; at < size; at++) out.push(`    if ((r + ${at}) & mask) y = (y + ${at & 7}) | 0; if ((r ^ ${at}) & mask) continue;`);
  out.push("    sum = (sum + r) | 0;", "  }", "  return sum + y;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(given[0] | 0, given[1] | 0)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
