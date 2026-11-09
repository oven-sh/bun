// In a loop a function is called that calls the next in a loop of its own, SIZE deep.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 1 3 6
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
      `function step${copy}_${level}(x: number): number { let s = 0; for (let i = 0; i < 2; i++) s = (s + step${copy}_${level + 1}(x + i)) | 0; return s; }`,
    );
  out.push(
    `function work${copy}(n: number): number { let sum = 0; for (let turn = 0; turn < n; turn++) sum = (sum + step${copy}_1(turn)) | 0; return sum; }`,
  );
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + Math.round(work${copy}(2))) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
