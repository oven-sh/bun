// SIZE records of SIZE shapes are handed to one function, each by a call of its own, and the function reads SIZE names off its parameter. Each of those names is listed by one record.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 1500 3000 6000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function count${copy}(o) {`, "  let sum = 0;");
  for (let at = 0; at < size; at++) out.push(`  sum += o.f${copy}x${at} | 0;`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) {
  for (let at = 0; at < size; at++) out.push(`told += count${copy}({ name: ${at}, f${copy}x${at}: 1 });`);
}
out.push("console.log(told);");
console.log(out.join("\n"));
