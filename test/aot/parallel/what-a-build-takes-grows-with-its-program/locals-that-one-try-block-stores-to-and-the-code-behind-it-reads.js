// SIZE locals of one function. One try block stores to each of them what a call gives that may throw, its handler is empty, and the code behind the statement reads them all.
// What the build holds at its peak grows in line with the program as well, but a local is dear: 21 KB for 78 bytes of source. At 4,000 locals that is 76 MB on x64 and 81 MB on arm64 more
// than at 250, where the bound of this driver gives 87: that is nearer than two looks of the driver, which looks every 50 ms, are to one another. So the sizes end at 2,000, where the
// build holds 35 to 37 MB more than at 250 and may hold 57. What a local costs is what ought to fall.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 2000
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
  out.push("  } catch {", "  }");
  for (let at = 0; at < size; at++) out.push(`  sum = mix(sum, local${at});`);
  out.push(`  return mix(sum, local0 + local${size - 1});`, "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++)
  out.push(`for (throwsAt of [-1, ${size >> 1}, 0, ${size - 1}]) told = mix(told, work${copy}());`);
out.push("console.log(told);");
console.log(out.join("\n"));
