// SIZE loops one behind the other in one function. All read and write the same variables.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 1000
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let sum = 0, a = 1, b = 2, c = 3, d = 4;");
  for (let at = 0; at < size; at++)
    out.push(
      `  for (let i = 0; i < n; i++) { sum = (sum + ((a * 31) ^ (b + ${at & 7}))) | 0; a = (a + c) | 0; b = (b ^ sum) | 0; c = (c + d) | 0; d = (d ^ i) | 0; }`,
    );
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
