// `function below(i, n) { return i < n ? true : false; }` is copied in line at SIZE places under one yes: every copy proves something of the same two values from outside it.
// It writes a program: SIZE says how many places.
// What a copy proves of a value from outside is noted as a checked name of that value: the names of one value make a chain that only grows, and a state that held none of them walked it whole at every mention of the value.
// Sizes: 1500 3000 6000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
const out = [];
out.push(
  "function below(i: number, n: number): boolean { return i < n ? true : false; }",
  "function pick(low: number, high: number, i: number, n: number): number {",
  "  let sum = 0;",
  "  if (below(low, high)) {",
);
for (let place = 0; place < size; place++) out.push("    if (below(i, n)) sum += 1;");
out.push("  }", "  return sum;", "}", "console.log(pick(1, 2, 3, 4), pick(1, 2, 4, 3), pick(2, 1, 3, 4));");
console.log(out.join("\n"));
