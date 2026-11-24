// `hit: { switch (k) { case 0: case 1: case 2: case 3: break hit; } switch (k) { case 4: .. break hit; } .. return 0; } return 1;`: SIZE switches in a row on one value whose cases all lead to one place. The first takes the
// others in: each is read once and left out. Every second one lists the first four values again, so that what is taken in also holds cases that are listed already.
// It writes a program: SIZE says how many switches stand in a row, PASSES how many functions hold such a row.
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
    lines.push(`  switch (k) { case ${first}: case ${first + 1}: case ${first + 2}: case ${first + 3}: break hit; }`);
  }
  lines.push(`  return ${copy}; } return ${copy + 1}; }`);
}
lines.push("let sum = 0;");
for (let copy = 0; copy < copies; copy++) lines.push(`for (let k = -2; k < ${size * 4 + 3}; k++) sum = sum * 3 % 1000003 + f${copy}(k);`);
lines.push("console.log(sum);");
console.log(lines.join("\n"));
