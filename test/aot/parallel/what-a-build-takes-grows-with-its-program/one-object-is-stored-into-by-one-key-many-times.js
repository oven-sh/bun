// `held[key] = 7;` SIZE times in one function whose only caller hands a number over as the key: each store calls on a rare way and takes its operands in named registers, so `held` and `key` are moved
// out of the way of each one, and each time it is asked whether a register that calls keep and that is not saved yet is worth taking for them. Every read of the two lies in a rare region, so the
// answer is found only at the end of the list of their reads: it is asked once a value, not once a store.
// It writes a program: SIZE says how many stores a function holds, PASSES how many such functions there are.
// Sizes: 1000 2000 12000
// Passes: 1
// Room of the peak: 90 MB: the peak rises in line with the size, by what is held for the one unit that holds all the stores while it is compiled: 8.5 KB a store of 20 bytes: up to the link two sizes 8,000 stores apart differ by 17 MB, in `GenerateCode | compile units` by 85 (174 | 259 MB).
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const lines = [];
for (let copy = 0; copy < copies; copy++) {
  lines.push(`function stores${copy}(key) {`);
  lines.push("  let sum = 0;");
  lines.push("  const held = { a: 1, b: 2 };");
  for (let index = 0; index < size; index++) lines.push(`  held[key] = ${index};`);
  lines.push("  return sum;");
  lines.push("}");
}
lines.push(`console.log(${Array.from({ length: copies }, (_, copy) => `stores${copy}(1)`).join(" + ")});`);
console.log(lines.join("\n"));
