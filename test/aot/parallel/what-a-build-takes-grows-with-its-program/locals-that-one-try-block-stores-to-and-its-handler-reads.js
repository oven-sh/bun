// SIZE locals of one function. One try block stores to each of them what a call gives that may throw, and the handler reads them all.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [
  "let throwsAt = -1;",
  "function give(at: number): number { for (let turn = 0; turn < 1; turn++) if (at === throwsAt) throw at; return at * 7 + 1; }",
  "function mix(sum: number, value: number): number { for (let turn = 0; turn < 1; turn++) sum = (sum * 33 + value) % 1000003; return sum; }",
];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(): number {`, "  let sum = 1;");
  for (let at = 0; at < size; at++) out.push(`  let local${at} = 0;`);
  out.push("  try {");
  for (let at = 0; at < size; at++) out.push(`    local${at} = give(${at});`);
  out.push("  } catch {");
  for (let at = 0; at < size; at++) out.push(`    sum = mix(sum, local${at});`);
  out.push("  }");
  out.push(`  return mix(sum, local0 + local${size - 1});`, "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++)
  out.push(`for (throwsAt of [-1, ${size >> 1}, 0, ${size - 1}]) told = mix(told, work${copy}());`);
out.push("console.log(told);");
console.log(out.join("\n"));
