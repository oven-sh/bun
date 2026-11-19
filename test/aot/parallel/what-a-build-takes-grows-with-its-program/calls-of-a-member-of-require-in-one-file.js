// SIZE lines of one CommonJS file each call `require.resolve()`. Whether anything in the file lets `require` get members of the program's is a question about the whole file, and it was asked anew
// at every such call, walking every name and every expression: 4,000 | 8,000 | 16,000 lines took 10.4 | 33.8 | 125.6 G instructions.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 1000 2000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["let found = 0;"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}() {`);
  for (let at = 0; at < size; at++) out.push(`  if (require.resolve("node:path")) found++;`);
  out.push("}", `run${copy}();`);
}
out.push("console.log(found);");
console.log(out.join("\n"));
