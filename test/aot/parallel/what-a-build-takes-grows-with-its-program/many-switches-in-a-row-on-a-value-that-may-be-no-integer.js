// The row of many-switches-in-a-row-on-one-value-that-lead-to-one-place.js, asked with whole numbers, fractions and texts, so that its subject is no int32: what is no integer leaves the first search too, and must leave it behind the
// last one: by the first search's own `otherwise` the second search was generated and took in all behind it again: SIZE * SIZE / 2 cases, SIZE tables. Each switch also holds a case that only leads on to the next.
// It writes a program: SIZE says how many switches stand in a row, PASSES how many functions hold such a row; the first function takes numbers, the second anything.
// Sizes: 500 1000 2000
// Passes: 2
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const lines = [];
for (let copy = 0; copy < copies; copy++) {
  lines.push(`function f${copy}(k) { hit: {`);
  for (let row = 0; row < size; row++) {
    const first = row & 1 ? 0 : row * 4;
    lines.push(`  switch (k) { case ${first}: case ${first + 1}: case ${first + 2}: case ${first + 3}: break hit; case ${size * 4 + 9 + row}: break; }`);
  }
  lines.push(`  return ${copy}; } return ${copy + 1}; }`);
}
lines.push("let sum = 0;");
for (let copy = 0; copy < copies; copy++) lines.push(`for (let k = -2; k < ${size * 5 + 12}; k++) sum = sum * 3 % 1000003 + f${copy}(k) + f${copy}(k + 0.5)${copy & 1 ? ` + f${copy}(String(k)) + f${copy}(k & 1 ? null : undefined)` : ""};`);
lines.push("console.log(sum);");
console.log(lines.join("\n"));
