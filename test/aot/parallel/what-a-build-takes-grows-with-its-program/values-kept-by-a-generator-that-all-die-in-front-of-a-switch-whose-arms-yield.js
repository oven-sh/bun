// A generator that is made keeps SIZE values across a yield and reads them all for the last time in front of a switch with SIZE arms, each of which yields.
// They are cleared out of the frame of the generator behind that read, once, and not in each arm.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 25 100 400
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["const make = tag => JSON.parse(JSON.stringify({ tag }));", "let sum = 0;", "function note(value) { sum = (sum * 31 + value) | 0; }"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function* steps${copy}(pick) {`);
  for (let at = 0; at < size; at++) out.push(`  const v${at} = make(${at});`);
  out.push("  yield -1;", `  note(${Array.from({ length: size }, (_, at) => `v${at}.tag`).join(" + ")});`, "  switch (pick) {");
  for (let at = 0; at < size; at++) out.push(`    case ${at}: yield ${at}; break;`);
  out.push("  }", "  yield -2;", "  return -3;", "}");
}
out.push("function run(steps, pick) { const made = steps(pick); globalThis.held = made; for (;;) { const step = made.next(); if (step.done) return; note(step.value); } }");
for (let copy = 0; copy < copies; copy++) out.push(`run(steps${copy}, 0); run(steps${copy}, ${size - 1}); run(steps${copy}, ${size});`);
out.push("console.log(sum);");
console.log(out.join("\n"));
