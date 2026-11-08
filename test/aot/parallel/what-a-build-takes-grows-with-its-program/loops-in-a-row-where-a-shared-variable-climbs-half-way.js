// SIZE loops in a row. One of the shared variables is a whole number until the loop in the middle makes a fraction of it.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 1000
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let sum = 0.25, a = 1, b = 2, x = 0;");
  for (let at = 0; at < size; at++)
    out.push(
      `  for (let i = 0; i < n; i++) { a = (a + ${at & 7}) | 0; b = (b ^ a) | 0; sum = sum + ((a * 31) ^ b) + x;${at === size >> 1 ? " x = x + 0.5;" : ""} }`,
    );
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
