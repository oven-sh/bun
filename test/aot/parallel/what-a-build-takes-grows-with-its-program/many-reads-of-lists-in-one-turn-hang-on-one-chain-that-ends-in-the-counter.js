// `const k0 = i - i; const k1 = k0 - 0; const k2 = k1 - 0; ..`, SIZE steps, in the turn of a loop over `i`, and a sixteenth as many reads `rows[kSIZE][0]` behind them. Whether a list is found by reads from in
// front of the loop is refused at the deepest step of the chain, the counter; each of the reads walked the whole refused chain again: SIZE * SIZE / 16 steps; and each step of the chain followed its result to the end of the chain.
// It writes a program: SIZE says how many steps, PASSES how many functions with such a loop.
// Sizes: 4000 8000 16000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["const tool = { rows: [[1.5, 2.5, 3.5]] };"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function f${copy}(t) { const rows = tool.rows; let s = t & 1; for (let i = 0; i < 3; i++) { const k0 = i - i;`);
  for (let step = 1; step <= size; step++) out.push(`  const k${step} = k${step - 1} - 0;`);
  for (let read = 0; read < size / 16; read++) out.push(`  s = s + rows[k${size}][0];`);
  out.push("  } return s; }");
}
out.push("let sum = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`sum += f${copy}(${copy});`);
out.push("console.log(sum);");
console.log(out.join("\n"));
