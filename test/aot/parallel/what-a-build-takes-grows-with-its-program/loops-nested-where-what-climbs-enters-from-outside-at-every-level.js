// Loops nested SIZE deep. Each level has a variable that the innermost turn reads and that climbs BEHIND the loop of the next level: the loops within are entered anew with a wider type, level by level.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 2 4 8
// Passes: 100
// Grows: the build, a square
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
const levels = Array.from({ length: size }, (_, k) => k + 1);
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function work${copy}(n: number): number {`,
    `  let sum = 0.25, a = 1, b = 2, ${levels.map(level => `v${level} = 0`).join(", ")};`,
  );
  for (const level of levels) out.push(`${pad(level)}for (let i${level} = 0; i${level} < n; i${level}++) {`);
  out.push(
    `${pad(size + 1)}a = (a + 1) | 0; b = (b ^ a) | 0; sum = sum + ((a * 31) ^ (b + 7)) + ${levels.map(level => `v${level}`).join(" + ")};`,
  );
  for (const level of levels.toReversed()) out.push(`${pad(level + 1)}v${level} = v${level} + 0.5;`, `${pad(level)}}`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
