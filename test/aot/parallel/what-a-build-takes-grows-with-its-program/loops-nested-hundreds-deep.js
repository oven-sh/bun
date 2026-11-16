// Loops nested SIZE deep, hundreds of them, and one statement innermost. What is asked of a loop is asked of all that lies in it, the loops inside included: blocks x depth.
// No program has such a nest, and at the depths that programs have the build is linear: ./loops-nested-where-every-head-fits-at-once.js. This one holds the build to the square that it is
// today: 584 | 662 | 924 M instructions, and 1,864 M at 800. The goal is linear: the rows of a loop hold their own level and ask the loops inside for theirs.
// What the build holds is a square too: each loop that is open keeps the types of all the values of the body. At 800 that is 45 MB more than at 200, where the bound of this driver gives 38:
// it was met or not by where the driver, which looks every 50 ms, happened to look. So the sizes end at 400, where the build holds 11 MB more than at 100. That goal is linear as well.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 100 200 400
// Passes: 1
// Grows: the build, a square
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}() {`, "  let sum = 0;");
  for (let level = 0; level < size; level++) out.push(`for (let i${level} = 0; i${level} < 1; i${level}++) {`);
  out.push("sum++;");
  for (let level = 0; level < size; level++) out.push("}");
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told += run${copy}();`);
out.push("console.log(told);");
console.log(out.join("\n"));
