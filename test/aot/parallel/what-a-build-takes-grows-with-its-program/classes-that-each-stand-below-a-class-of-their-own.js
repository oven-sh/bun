// SIZE pairs of classes, the second of each below the first. One pair in three is used, the others are only defined.
// It writes a program: SIZE says how many pairs, PASSES how many copies of them under names of their own.
// Sizes: 100 200 400
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 3),
  copies = Number(process.env.PASSES ?? 1);
const out = ["let told = 0;"];
for (let copy = 0; copy < copies; copy++) {
  for (let pair = 0; pair < size; pair++) {
    const name = `${copy}_${pair}`;
    out.push(
      `class Above${name} { a = ${pair}; first() { return this.a; } static kind() { return ${pair}; } }`,
      `class Below${name} extends Above${name} { b = ${pair + 1}; second() { return this.b + this.first(); } }`,
    );
    if (pair % 3 === 0) out.push(`told += new Below${name}().second() + Below${name}.kind();`);
  }
}
out.push("console.log(told);");
console.log(out.join("\n"));
