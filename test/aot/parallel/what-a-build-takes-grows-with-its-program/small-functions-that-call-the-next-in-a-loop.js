// In a loop a small function without a loop is called that calls the next, SIZE deep: the chain that is copied today.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Up to the third level the levels cost unevenly, from there on each costs the same: the sizes begin there.
// Sizes: 3 6 12
// Passes: 60
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const pad = depth => "  ".repeat(depth);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function step${copy}_${size + 1}(x: number): number { return (x * 31) ^ 7; }`);
  for (let level = size; level >= 1; level--)
    out.push(
      `function step${copy}_${level}(x: number): number { return (step${copy}_${level + 1}(x + ${level}) + 1) | 0; }`,
    );
  out.push(
    `function work${copy}(n: number): number { let sum = 0; for (let turn = 0; turn < n; turn++) sum = (sum + step${copy}_1(turn)) | 0; return sum; }`,
  );
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
