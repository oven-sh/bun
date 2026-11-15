// The same with null that becomes an object behind the loop of the next level, read by the innermost turn.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 2 4 8
// Passes: 100
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
out.push(
  "class Knot { next: Knot | null; mark: number; constructor(next: Knot | null, mark: number) { this.next = next; this.mark = mark; } }",
);
const levels = Array.from({ length: size }, (_, k) => k + 1);
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function work${copy}(n: number): number {`,
    "  let sum = 0, a = 1, b = 2;",
    ...levels.map(level => `  let knot${level}: Knot | null = null;`),
  );
  for (const level of levels) out.push(`${pad(level)}for (let i${level} = 0; i${level} < n; i${level}++) {`);
  out.push(`${pad(size + 1)}sum = (sum + ((a * 31) ^ (b + 7))) | 0; a = (a + 1) | 0; b = (b ^ sum) | 0;`);
  for (const level of levels)
    out.push(`${pad(size + 1)}if (knot${level} !== null) sum = (sum + knot${level}.mark) | 0;`);
  for (const level of levels.toReversed())
    out.push(`${pad(level + 1)}knot${level} = new Knot(knot${level}, i${level});`, `${pad(level)}}`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
