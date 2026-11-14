// SIZE loops in a row. Each fills a variable of its own, and all of them are read at the end.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 1000
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let a = 1;");
  for (let at = 0; at < size; at++)
    out.push(
      `  let kept${at} = ${at & 15}; for (let i = 0; i < n; i++) { kept${at} = (kept${at} + a) | 0; a = (a ^ i) | 0; }`,
    );
  out.push("  let sum = 0;");
  for (let at = 0; at < size; at += 8)
    out.push(
      `  sum = (sum + ${Array.from({ length: Math.min(8, size - at) }, (_, k) => `kept${at + k}`).join(" + ")}) | 0;`,
    );
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
