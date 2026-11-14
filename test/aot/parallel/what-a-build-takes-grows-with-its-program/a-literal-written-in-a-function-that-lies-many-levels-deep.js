// A function hands out `[[[ .. [1] .. ]]]`, SIZE levels deep. Each level above a list of leaves is born by code, and each level asked anew how deep the literal below it lies and whether a list of
// leaves lies inside: two looks down to the bottom at every level: 629 | 823 | 1,572 M instructions where the same literal as one record of data took 561 | 566 | 576.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 500 1000 2000
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) out.push(`function make${copy}() { return ${"[".repeat(size)}${copy}${"]".repeat(size)}; }`);
out.push("let levels = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`for (let at = make${copy}(); Array.isArray(at); at = at[0]) levels++;`);
out.push("console.log(levels);");
console.log(out.join("\n"));
