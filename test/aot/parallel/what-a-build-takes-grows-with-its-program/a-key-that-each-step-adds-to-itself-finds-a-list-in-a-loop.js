// `const k1 = k0 + k0; const k2 = k1 + k1; ..`, SIZE steps, in the turn of a loop, and `tool.rows[kSIZE][i]` behind them. Whether the list is found by reads from in front of the
// loop was asked operand by operand, and a value that is mentioned twice was gone into twice: the work doubled with each step: 1.28 | 1.28 | 6.96 | 92.01 G instructions at 14 | 18 | 22 | 26
// steps, and 40 steps had no end.
// It writes a program: SIZE says how many steps, PASSES how many functions with such a loop.
// Sizes: 100 200 400
// Passes: 10
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["const tool = { rows: [[1.5, 2.5, 3.5]], add(a, b) { return a + b; } };"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function f${copy}(t) { let s = t & 1; for (let i = 0; i < 3; i++) { const k0 = t - t;`);
  for (let step = 1; step <= size; step++) out.push(`  const k${step} = k${step - 1} + k${step - 1};`);
  out.push(`  s = s + tool.rows[k${size}][i] * 2; } return s; }`);
}
out.push("let sum = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`sum += f${copy}(${copy});`);
out.push("console.log(sum);");
console.log(out.join("\n"));
