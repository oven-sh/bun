// `type M1 = Map<M0, M0>; type M2 = Map<M1, M1>; ..`, SIZE levels deep, and what a function answers under the last of them is stored into a field by a constructor function. The word for
// that field was gone through content by content, and a type that is named twice was gone into twice: the work doubled with each level: 0.68 | 2.32 | 7.55 G instructions at 16 | 20 | 22
// levels, and 32 levels had no end.
// It writes a program: SIZE says how many levels, PASSES how many chains under names of their own.
// Sizes: 100 200 400
// Passes: 20
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`type M${copy}_0 = Map<string, ${copy}>;`);
  for (let level = 1; level <= size; level++) out.push(`type M${copy}_${level} = Map<M${copy}_${level - 1}, M${copy}_${level - 1}>;`);
  out.push(`function make${copy}(): M${copy}_${size} { return new Map(); }`);
  out.push(`function Box${copy}(this: any) { this.held = make${copy}(); }`);
  out.push(`Box${copy}.prototype.size = function () { return this.held.size; };`);
}
out.push("let sizes = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`sizes += new (Box${copy} as any)().size() + 1;`);
out.push("console.log(sizes);");
console.log(out.join("\n"));
