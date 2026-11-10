// `function below(i, n) { return i < n ? true : false; }` is copied in line at SIZE places, each with a lower bound than the one before, and only the way of its yes goes on: every copy narrows the same value further.
// It writes a program: SIZE says how many places.
// Each copy was handed the narrowest name of the value and noted the next name of that name: a chain that was gone down link by link at every mention of the value.
// Sizes: 1500 3000 6000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
const out = [];
out.push(
  "function below(i: number, n: number): boolean { return i < n ? true : false; }",
  "function pick(i: number): number {",
  "  const j = i | 0;",
  "  let sum = 0;",
);
for (let place = 0; place < size; place++) out.push(`  if (below(j, ${2 * size - place})) sum += 1; else return sum;`);
out.push("  return sum;", "}", `console.log(pick(1), pick(${size + 3}), pick(${3 * size}));`);
console.log(out.join("\n"));
