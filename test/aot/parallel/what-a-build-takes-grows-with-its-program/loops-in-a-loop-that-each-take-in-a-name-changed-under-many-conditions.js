// SIZE conditions that each may change one name, then SIZE loops that each take that name in, all in one loop. What enters every one of them is the parameter of the last block where ways meet:
// the look through those blocks notes what it found by the record it began at, so the second loop asks the note and does not go through all the blocks again.
// What the build holds at its peak grows in line with the program as well, but a condition with its loop is dear: 100 to 130 KB for 128 bytes of source. At 320 that is 26 MB on x64 and
// 31 MB on arm64 more than at 20, where the bound of this driver gives 39: that is nearer than two looks of the driver, which looks every 50 ms, are to one another. So the sizes end
// at 160, where the build holds 10 MB more than at 20 and may hold 35. What a condition with its loop costs is what ought to fall.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 20 80 160
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const given = JSON.parse("[3,0]");'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n, mask) {`, "  let y = 0, sum = 0;", "  for (let r = 0; r < n; r++) {");
  for (let at = 0; at < size; at++) out.push(`    if ((r + ${at}) & mask) y = (y + ${at & 7}) | 0;`);
  for (let at = 0; at < size; at++) out.push("    { let z = y; for (let i = 0; i < n; i++) z = (z + i) | 0; sum = (sum + z) | 0; }");
  out.push("  }", "  return sum + y;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(given[0] | 0, given[1] | 0)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
