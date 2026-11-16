// One function calls a helper SIZE times, line below line with no branch between them. The helper has a loop and two returns, and each call hands it a closure of its own.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 100 400 1000
// Passes: 1
// Grows: the build, linear
// Room of the peak: 62 MB: each line of 37 bytes copies a helper with a loop in line, and each read of that loop is built in two arms: 56 KB of peak a call where it was 33,
//   in line from 100 to 4,000 calls (83 91 103 134 196 313 MB). The back end holds 343 bytes a machine operation where it held 275, and a call makes 146 of them where it made 91.
//   The most that was read: 81 | 94 | 135 MB (Ubuntu 25.04, aarch64), 89 | 101 | 143 MB (x64), and a tenth above.
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
out.push(
  "function find(list, accepts) {",
  "  for (let i = 0; i < list.length; i++) {",
  "    if (accepts(list[i])) return i;",
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
