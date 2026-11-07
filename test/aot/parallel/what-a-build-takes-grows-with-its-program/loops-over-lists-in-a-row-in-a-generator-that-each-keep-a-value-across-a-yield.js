// SIZE for-of loops in a row in a generator that is made. Each turn keeps a value of its own across a yield, and each loop its iterator.
// What is dead is cleared out of the frame of the generator once, and not at every yield that follows.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 25 100 400
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function* steps${copy}(list) {`, "  let sum = 0;");
  for (let at = 0; at < size; at++)
    out.push(`  for (const x${at} of list) { const o${at} = list[(x${at}.i + ${at}) % list.length]; yield sum; sum += o${at}.i; }`);
  out.push("  return sum;", "}");
}
out.push(
  "function run(steps) { const made = steps(JSON.parse('[{\"i\":1},{\"i\":2},{\"i\":3}]')); globalThis.held = made; for (;;) { const step = made.next(); if (step.done) return step.value; } }",
  "let told = 0;",
);
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run(steps${copy})) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
