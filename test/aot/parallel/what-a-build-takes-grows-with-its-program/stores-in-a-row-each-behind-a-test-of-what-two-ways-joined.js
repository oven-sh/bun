// SIZE stores in a row into one field. Each stands behind a test of a variable that two ways have joined, and one of the two is the variable of the line above.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 10 100 1000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [
  "class Holder {",
  "  held: string | undefined = undefined;",
  "}",
  "function get(i: number): string | number {",
  "  let w = 0;",
  "  for (let k = 0; k < 2; k++) w = (w + k) | 0;",
  '  return (i + w) % 3 ? "t" + i : i;',
  "}",
];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(h: Holder, c: boolean): void {`, "  let v: string | number = get(0);");
  for (let at = 0; at < size; at++)
    out.push(`  v = c ? v : get(${at + 1});`, '  if (typeof v === "string") h.held = v;');
  out.push("}");
}
out.push("const h = new Holder();");
for (let copy = 0; copy < copies; copy++) out.push(`for (let t = 0; t < 3; t++) work${copy}(h, t === 1);`);
out.push("console.log(String(h.held));");
console.log(out.join("\n"));
