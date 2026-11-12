// SIZE locals of one function. One try block stores to each of them what a call gives that may throw, its handler stores to each once more, and the finalizer reads them all.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 250 1000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [
  "let throwsAt = -1, seen = 1;",
  "function give(at: number): number { for (let turn = 0; turn < 1; turn++) if (at === throwsAt) throw at; return at * 7 + 1; }",
  "function mix(sum: number, value: number): number { for (let turn = 0; turn < 1; turn++) sum = (sum * 33 + value) % 1000003; return sum; }",
];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(again: number): number {`);
  for (let at = 0; at < size; at++) out.push(`  let local${at} = 0;`);
  out.push("  try {");
  for (let at = 0; at < size; at++) out.push(`    local${at} = give(${at});`);
  out.push("  } catch {", "    throwsAt = again;");
  for (let at = 0; at < size; at++) out.push(`    local${at} += give(${at});`);
  out.push("  } finally {");
  for (let at = 0; at < size; at++) out.push(`    seen = mix(seen, local${at});`);
  out.push("  }");
  out.push(`  return local0 + local${size - 1};`, "}");
}
for (let copy = 0; copy < copies; copy++)
  out.push(
    `for (const [first, again] of [[-1, -1], [${size >> 1}, -1], [${size >> 2}, ${size >> 1}], [0, ${size - 1}]]) {`,
    `  throwsAt = first;`,
    `  try { seen = mix(seen, work${copy}(again)); } catch (thrown) { seen = mix(seen, thrown as number); }`,
    "}",
  );
out.push("console.log(seen);");
console.log(out.join("\n"));
