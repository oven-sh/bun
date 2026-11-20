// One function calls a helper SIZE times, line below line with no branch between them. The helper goes over a list with for-of and has two returns, and each call hands it a closure of its own.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 50 200 400
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
out.push(
  "function find(list, accepts) {",
  "  for (const x of list) {",
  "    if (accepts(x)) return x;",
  "  }",
  "  return -1;",
  "}",
);
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(lists) {`, "  let sum = 0;");
  for (let line = 0; line < size; line++) out.push(`  sum += find(lists[${line % 7}], x => x > ${(line + copy) % 13});`);
  out.push("  return sum;", "}");
}
out.push('const lists = JSON.parse("[[1,2,3],[4,5],[6],[7,8,9,10],[],[11],[12,13]]");', "let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + work${copy}(lists)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
