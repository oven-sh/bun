// SIZE lines in a row. Each takes an object out of a list, returns early by one of its fields and keeps another in a variable of its own, and all of them are read at the end.
// One object of the list comes out of JSON.parse, so each line guesses what it has read, and from the first guess on a way that knows and a way that does not run side by side.
// What the build holds at its peak grows in line with the program as well, but a line is dear: 59 KB on x64, 46 KB on arm64, for 117 bytes of source. At 1,000 lines that is 45 MB more
// than at 250, where the bound of this driver gives 49: that is nearer than two looks of the driver, which looks every 50 ms, are to one another. So the sizes end at 500, where the
// build holds 18 to 22 MB more than at 125 and may hold 40. What a line costs is what ought to fall.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 125 250 500
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [
  "class Item {",
  "  skip: boolean;",
  "  weight: number;",
  "  constructor(skip: boolean, weight: number) {",
  "    this.skip = skip;",
  "    this.weight = weight;",
  "  }",
  "}",
  'const items: Item[] = [new Item(false, 2), JSON.parse(\'{"skip":false,"weight":3}\'), new Item(false, 5)];',
];
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function work${copy}(list: Item[]): number {`,
    "  let sum = 0;",
    "  for (let i = 0; i < 2; i++) sum = (sum + i) | 0;",
  );
  for (let at = 0; at < size; at++)
    out.push(`  const item${at} = list[${at % 3}]; if (item${at}.skip) return -1; const kept${at} = item${at}.weight;`);
  for (let at = 0; at < size; at++) out.push(`  sum = (sum + kept${at}) | 0;`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++)
  out.push(`for (let t = 0; t < 3; t++) told = (told + work${copy}(items)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
