// Loops nested SIZE deep. At each head a variable enters as null and comes round as an object.
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
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let sum = 0, a = 1, b = 2;");
  for (let level = 1; level <= size; level++)
    out.push(
      `${pad(level)}let knot${level}: Knot | null = null;`,
      `${pad(level)}for (let i${level} = 0; i${level} < n; i${level}++) {`,
    );
  out.push(`${pad(size + 1)}sum = (sum + ((a * 31) ^ (b + 7))) | 0; a = (a + 1) | 0; b = (b ^ sum) | 0;`);
  for (let level = size; level >= 1; level--)
    out.push(
      `${pad(level + 1)}knot${level} = new Knot(knot${level}, i${level});`,
      `${pad(level)}}`,
      `${pad(level)}if (knot${level} !== null) sum = (sum + knot${level}.mark) | 0;`,
    );
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
