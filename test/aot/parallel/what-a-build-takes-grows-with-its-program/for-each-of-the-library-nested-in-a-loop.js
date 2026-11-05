// In a loop forEach is handed a closure that calls forEach, SIZE deep.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 1 3 6
// Passes: 60
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
out.push("const pair = [1, 2];");
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let sum = 0;", "  for (let turn = 0; turn < n; turn++) {");
  for (let level = 1; level <= size; level++) out.push(`${pad(level + 1)}pair.forEach(x${level} => {`);
  out.push(`${pad(size + 2)}sum = (sum + ${Array.from({ length: size }, (_, k) => `x${k + 1}`).join(" + ")}) | 0;`);
  for (let level = size; level >= 1; level--) out.push(`${pad(level + 1)}});`);
  out.push("  }", "  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
