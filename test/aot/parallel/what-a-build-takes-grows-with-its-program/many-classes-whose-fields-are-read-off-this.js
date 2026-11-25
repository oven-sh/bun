// SIZE small classes in one file: a constructor's parameter fills two fields of each, and a method reads them off `this`. Of each field the front end asks what the uses of `this.<name>` say:
// the reads off `this` are listed once a file, by class and name, not walked once a field. What the build takes grows as the file does.
// It writes a program: SIZE says how many classes, PASSES how many copies of them under names of their own.
// Sizes: 400 1600 6400
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["let sum = 0;"];
for (let copy = 0; copy < copies; copy++)
  for (let at = 0; at < size; at++)
    out.push(`class C${copy}x${at} { constructor(given) { this.a = given; this.b = given + ${at}; } both() { return this.a + this.b; } }`, `sum += new C${copy}x${at}(${copy}).both();`);
out.push("console.log(sum);");
console.log(out.join("\n"));
