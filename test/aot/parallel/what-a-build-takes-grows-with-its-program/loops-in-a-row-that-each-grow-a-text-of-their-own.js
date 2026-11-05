// SIZE loops in a row. Each grows a text of its own, which is read once behind its loop.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 1000
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
