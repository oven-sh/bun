// A generator that is made keeps SIZE values across a yield. Behind it a switch has SIZE arms, each with a branch and a join of its own, and each reads one of the values.
// In every arm all the other values are dead: they are cleared out of the frame of the generator where the arms meet, and not in each arm.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 25 100 400
// Passes: 4
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["const make = tag => JSON.parse(JSON.stringify({ tag }));", "let sum = 0;", "function note(value) { sum = (sum * 31 + value) | 0; }"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function* steps${copy}(pick, flag) {`);
  for (let at = 0; at < size; at++) out.push(`  const v${at} = make(${at});`);
  out.push("  yield -1;", "  switch (pick) {");
  for (let at = 0; at < size; at++) out.push(`    case ${at}: if (flag) note(v${at}.tag); else note(v${at}.tag + 1); note(${at}); break;`);
  out.push("  }", "  yield -2;", "  return -3;", "}");
}
out.push("function run(steps, pick, flag) { const made = steps(pick, flag); globalThis.held = made; for (;;) { const step = made.next(); if (step.done) return; note(step.value); } }");
for (let copy = 0; copy < copies; copy++) out.push(`run(steps${copy}, 0, true); run(steps${copy}, ${size - 1}, false); run(steps${copy}, ${size}, true);`);
out.push("console.log(sum);");
console.log(out.join("\n"));
