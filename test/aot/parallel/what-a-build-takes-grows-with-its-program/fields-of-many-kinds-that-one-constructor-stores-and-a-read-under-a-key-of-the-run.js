// A class whose constructor stores SIZE fields of many kinds, and one read under a key that only the run knows. One test in front of the row says that no store finds a setter above,
// and each store creates its field on an object that the body has made and whose order of keys is known: it ends no guard. Where each store forgot the guards, the next one asked again
// for all names that were left, with a closed arm of its own that held all stores that were left: 4,095 fields took 30 s and 6 GB.
// It writes a program: SIZE says how large, PASSES how many copies of its class under names of their own.
// Sizes: 125 500 2000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 5),
  copies = Number(process.env.PASSES ?? 1);
const kinds = [at => String(at), at => at + ".5", at => JSON.stringify("t" + at), at => (at % 2 ? "true" : "false"), at => `{ v: ${at} }`];
const out = ['const pick = JSON.parse(\'["f3"]\')[0];'];
for (let copy = 0; copy < copies; copy++) {
  out.push(`class Wide${copy} {`, "  constructor() {");
  for (let at = 0; at < size; at++) out.push(`    this.f${at} = ${kinds[at % 5](at)};`);
  out.push("  }", "}");
}
for (let copy = 0; copy < copies; copy++) out.push(`console.log(String(new Wide${copy}()[pick]));`);
console.log(out.join("\n"));
