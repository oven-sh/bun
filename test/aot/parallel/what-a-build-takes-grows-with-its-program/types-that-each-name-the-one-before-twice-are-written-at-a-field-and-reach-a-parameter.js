// `type M1 = Map<M0, M0>; type M2 = Map<M1, M1>; ..`, SIZE levels deep; the last of them is written at a field of a class, and a value of it is handed to a function that says nothing of its
// parameter. Whoever widens such a type to the families of its layouts went into every written content, and a type that is named twice was gone into twice: the work doubled with each
// level: 0.60 | 1.18 | 3.02 G instructions at 16 | 20 | 22 levels, and 32 levels had no end.
// A square stays: the image numbers its types in the order of their contents, and two chains that differ at the bottom alone are held against each other level by level down to there
// (TypeArena::compareByContent() under ImageNumbersBuilder::numberTypes(): 78% of the build at 400 levels): 0.930 | 1.732 | 4.845 G.
// It writes a program: SIZE says how many levels, PASSES how many chains under names of their own.
// Sizes: 100 200 400
// Passes: 20
// Grows: the build, a square
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`type M${copy}_0 = Map<string, ${copy}>;`);
  for (let level = 1; level <= size; level++) out.push(`type M${copy}_${level} = Map<M${copy}_${level - 1}, M${copy}_${level - 1}>;`);
  out.push(`class Box${copy} { held: M${copy}_${size} = new Map(); size() { return this.held.size; } }`);
  out.push(`function size${copy}(held: any) { return held.size; }`);
}
out.push("let sizes = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`{ const box = new Box${copy}(); sizes += box.size() + size${copy}(box.held) + 1; }`);
out.push("console.log(sizes);");
console.log(out.join("\n"));
