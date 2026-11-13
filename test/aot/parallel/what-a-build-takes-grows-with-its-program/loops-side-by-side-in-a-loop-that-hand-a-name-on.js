// SIZE loops side by side in one loop, and one name that each hands to the next. What enters a loop is the parameter of the head of the loop in front of it, which is finished:
// a finished head says by a note which head's parameter it took in, so the look for what enters takes one step, not one for every loop in front.
// What the build holds at its peak grows in line with the program as well, but a loop is dear: 35 KB on x64, 43 KB on arm64, for 53 bytes of source. At 1,200 loops that is 40 and 46 MB
// more than at 75, where the bound of this driver gives 43: it was seen or not by where the driver, which looks every 50 ms, happened to look. So the sizes end at 500, where the build
// holds 9 to 16 MB more than at 75 and may hold 36. What a loop costs is what ought to fall.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 75 300 500
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ['const turns = JSON.parse("[3]")[0] | 0;'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}(n) {`, "  let x = 0;", "  for (let r = 0; r < n; r++) {");
  for (let at = 0; at < size; at++) out.push(`    for (let i = 0; i < n; i++) x = (x + i + ${at & 7}) | 0;`);
  out.push("  }", "  return x;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(turns)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
