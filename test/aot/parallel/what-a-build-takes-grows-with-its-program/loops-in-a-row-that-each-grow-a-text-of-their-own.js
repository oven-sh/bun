// SIZE loops in a row. Each grows a text of its own, which is read once behind its loop.
// What the build holds at its peak grows in line with the program as well, but a loop is dear: 53 KB on x64, 59 KB on arm64, for 151 bytes of source. At 1,000 loops that is 47 and 59 MB
// more than at 10, where the bound of this driver gives 60: that is nearer than two looks of the driver, which looks every 50 ms, are to one another. So the sizes end at 400, where the
// build holds 14 to 26 MB more than at 10 and may hold 43. What a loop costs is what ought to fall.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 400
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(seed: number, n: number): number {`, "  let sum = 0;");
  for (let at = 0; at < size; at++)
    out.push(
      "  {",
      '    let text = "";',
      `    for (let i = 0; i < n; i++) text += (seed + i + ${at}) & 7;`,
      `    sum = (sum + text.length + text.charCodeAt(0) + ${at}) | 0;`,
      "  }",
    );
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + work${copy}(1, 3) + work${copy}(5, 4)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
