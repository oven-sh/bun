// SIZE loops in a row. In each, four variables are written on one arm of a condition, between a call ahead of the conditions and a call behind them.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 1000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [
  "function helper(v: number): number {",
  "  let w = 0;",
  "  for (let k = 0; k < 2; k++) w = (w + k + v) | 0;",
  "  return w;",
  "}",
];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(seed: number, n: number): number {`, "  let sum = 0;");
  for (let at = 0; at < size; at++)
    out.push(
      "  {",
      `    let a = (seed + ${at}) | 0, b = (seed ^ ${at}) | 0, c = (seed - ${at}) | 0, d = (seed + ${2 * at}) | 0;`,
      "    for (let i = 0; i < n; i++) {",
      "      sum = (sum + helper(i)) | 0;",
      "      if (((a + i) & 1) === 0) a = (a + 3) | 0;",
      "      if (((b + i) & 2) === 0) b = (b ^ i) | 0;",
      "      if (((c + i) & 1) === 0) c = (c + b) | 0;",
      "      if (((d + i) & 2) === 0) d = (d + a) | 0;",
      "      sum = (sum + helper(a)) | 0;",
      "    }",
      "    sum = (sum ^ a ^ b ^ c ^ d) | 0;",
      "  }",
    );
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + work${copy}(1, 3) + work${copy}(5, 4)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
