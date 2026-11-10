// `if (j < <a bound>) sum += 1; else return sum;` is written at SIZE places, each with a lower bound than the one before, and only the way of its yes goes on: every question narrows the same value further.
// It writes a program: SIZE says how many places.
// Each yes gives the value a new name, made of the name before it: whoever asked what a name stands for went down the names one by one, at every mention of the value.
// Sizes: 1500 3000 6000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
const out = [];
out.push("function pick(i: number): number {", "  const j = i | 0;", "  let sum = 0;");
for (let place = 0; place < size; place++) out.push(`  if (j < ${2 * size - place}) sum += 1; else return sum;`);
out.push("  return sum;", "}", `console.log(pick(1), pick(${size + 3}), pick(${3 * size}));`);
console.log(out.join("\n"));
