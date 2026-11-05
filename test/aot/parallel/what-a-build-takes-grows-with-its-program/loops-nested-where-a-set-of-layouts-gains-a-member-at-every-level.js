// Loops nested SIZE deep. Behind the loop of each level a variable is given an object of a layout of that level's own: the set of what it may be gains a member a level.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 2 4 8
// Passes: 100
// Grows: the build, a square
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
const members = level => (level ? `m0: ${level}, own${level}: ${level}` : "m0: 1");
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function work${copy}(n: number): number {`,
    "  let sum = 0, a = 1, b = 2;",
    `  let box: { m0: number } = { ${members(0)} };`,
  );
  for (let level = 1; level <= size; level++)
    out.push(`${pad(level)}for (let i${level} = 0; i${level} < n; i${level}++) {`);
  out.push(`${pad(size + 1)}sum = (sum + ((a * 31) ^ (b + 7)) + box.m0) | 0; a = (a + 1) | 0; b = (b ^ sum) | 0;`);
  for (let level = size; level >= 1; level--)
    out.push(`${pad(level + 1)}box = { ${members(level)} };`, `${pad(level)}}`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
