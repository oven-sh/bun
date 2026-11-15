// SIZE records of SIZE shapes lie in one list that stays in sight, and one function reads SIZE names off its parameter. Each of those names is listed by one record.
// What met has a name, and a question about one name of it goes to the records that list the name, not to every record.
// It writes a program: SIZE says how large, PASSES how many copies of its list and its function under names of their own.
// Sizes: 1500 3000 6000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`const all${copy} = [`);
  for (let at = 0; at < size; at++) out.push(`  { name: ${at}, f${copy}x${at}: 1 },`);
  out.push("];", `function count${copy}(o) {`, "  let sum = 0;");
  for (let at = 0; at < size; at++) out.push(`  sum += o.f${copy}x${at} | 0;`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`for (const o of all${copy}) told += count${copy}(o);`);
out.push("console.log(told);");
console.log(out.join("\n"));
