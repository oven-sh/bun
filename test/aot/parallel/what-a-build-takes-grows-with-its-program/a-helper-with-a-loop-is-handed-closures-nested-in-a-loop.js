// In a loop a helper that calls its parameter in a loop of its own is handed a closure that does the same, SIZE deep.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// One deep the scope is taken by an argument of a call alone and is made by the function; from two on a closure holds a closure over it and it lies among the variables of the module: the sizes begin at two.
// Sizes: 2 4 6
// Passes: 60
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
out.push(
  "function each(list: number[], visit: (x: number) => void): void { for (let i = 0; i < list.length; i++) visit(list[i]!); }",
  "const pair = [1, 2];",
);
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let sum = 0;", "  for (let turn = 0; turn < n; turn++) {");
  for (let level = 1; level <= size; level++) out.push(`${pad(level + 1)}each(pair, x${level} => {`);
  out.push(`${pad(size + 2)}sum = (sum + ${Array.from({ length: size }, (_, k) => `x${k + 1}`).join(" + ")}) | 0;`);
  for (let level = size; level >= 1; level--) out.push(`${pad(level + 1)}});`);
  out.push("  }", "  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
