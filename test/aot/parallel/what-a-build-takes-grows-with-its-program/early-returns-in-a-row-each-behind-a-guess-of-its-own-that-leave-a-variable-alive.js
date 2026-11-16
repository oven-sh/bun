// SIZE lines in a row. Each takes another object out of a list, returns early by one of its fields and keeps another in a variable of its own, and all of them are read at the end.
// One object of the list comes out of JSON.parse, so every line guesses anew what it has read, and the way on which a guess fails meets the ways on which earlier guesses failed.
// What the build holds at its peak grows in line with the program as well, but a line is dear: 105 KB on x64, 120 KB on arm64, most of it the blocks that the back end lays for the one
// large function. At 500 lines that is 40 to 46 MB more than at 125, where the bound of this driver gives 40: it was met or not by where the driver, which looks every 50 ms, happened
// to look. So the sizes end at 250, where the build holds 23 MB more than at 60 and may hold 36. What a line costs is what ought to fall.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 60 125 250
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
  `for (let at = 3; at < ${size}; at++) items.push(new Item(false, at % 7));`,
];
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function work${copy}(list: Item[]): number {`,
    "  let sum = 0;",
    "  for (let i = 0; i < 2; i++) sum = (sum + i) | 0;",
  );
  for (let at = 0; at < size; at++)
    out.push(`  const item${at} = list[${at}]; if (item${at}.skip) return -1; const kept${at} = item${at}.weight;`);
  for (let at = 0; at < size; at++) out.push(`  sum = (sum + kept${at}) | 0;`);
  out.push("  return sum;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++)
  out.push(`for (let t = 0; t < 3; t++) told = (told + work${copy}(items)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
