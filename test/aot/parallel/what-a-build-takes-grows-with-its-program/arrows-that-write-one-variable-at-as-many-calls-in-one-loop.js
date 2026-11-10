// In one loop forEach is called SIZE times, each time with an arrow of its own that adds to the same variable of the function.
// It writes a program: SIZE says how many calls, PASSES how many copies of its function under names of their own.
// At each call a scope is made for the way that leaves the copied loops: as many scopes as calls.
// The sizes lie past two steps, which three sizes cannot tell from a square: up to 11 calls the function is copied into the body of the module, and up to 18 its loop is built twice.
// Sizes: 20 32 64
// Passes: 20
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
out.push("const pair = [1, 2], halves = [0.5, 1.5];");
for (let copy = 0; copy < copies; copy++) {
  out.push(`function work${copy}(n: number): number {`, "  let sum = 0;", "  for (let turn = 0; turn < n; turn++) {");
  for (let call = 0; call < size; call++) out.push(`    ${call & 1 ? "halves" : "pair"}.forEach(x => { sum += x + ${call}; });`);
  out.push("  }", "  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told += work${copy}(3);`);
out.push("console.log(told);");
console.log(out.join("\n"));
