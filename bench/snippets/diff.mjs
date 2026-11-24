import * as jsdiff from "diff";
import { bench, run, summary } from "../runner.mjs";

const lines = (count, line) => Array.from({ length: count }, (_, i) => line(i) + "\n").join("");
const code = i => (i % 5 === 4 ? "}" : `  const value${i} = compute(${i}, "argument");`);
const edited =
  (every, base = code) =>
  i =>
    i % every === every >> 1 ? `// edited ${i}` : base(i);
const wide = i => code(i) + " // 世界";

const texts = {
  "5 lines, 1 edit": [lines(5, code), lines(5, edited(5))],
  "1,000 lines, 1 edit": [lines(1000, code), lines(1000, edited(1000))],
  "1,000 lines, 25 edits": [lines(1000, code), lines(1000, edited(40))],
  "1,000 lines, 25 edits, UTF-16": [lines(1000, wide), lines(1000, edited(40, wide))],
  "1,000 lines, rewritten": [lines(1000, code), lines(1000, i => code(i + 1000))],
  "1,000 lines, reversed": [lines(1000, code), lines(1000, i => code(999 - i))],
  "1,000 lines, new file": ["", lines(1000, code)],
  "50,000 lines, 1 edit": [lines(50_000, code), lines(50_000, edited(50_000))],
  "50,000 lines, 100 edits": [lines(50_000, code), lines(50_000, edited(500))],
};

function compare(name, native, js) {
  summary(() => {
    if (typeof Bun !== "undefined") bench(`Bun.diff ${name}`, native);
    bench(`diff ${name}`, js);
  });
}

for (const [name, [a, b]] of Object.entries(texts)) {
  compare(
    `lines, ${name}`,
    () => Bun.diff.lines(a, b),
    () => jsdiff.diffLines(a, b),
  );
  compare(
    `hunks, ${name}`,
    () => Bun.diff.hunks(a, b),
    () => jsdiff.structuredPatch("a", "b", a, b, undefined, undefined, { context: 3 }),
  );
}

const [a, b] = texts["1,000 lines, 25 edits"];
const patch = jsdiff.createPatch("file", a, b);
const [oldLine, newLine] = ["const total = price * count + tax;", "const sum = price * amount + tax - rebate;"];
const [oldArray, newArray] = [a.split("\n"), b.split("\n")];

compare(
  "createPatch",
  () => Bun.diff.createPatch(a, b, { oldFileName: "file" }),
  () => jsdiff.createPatch("file", a, b, undefined, undefined, { context: 3 }),
);
compare(
  "parsePatch",
  () => Bun.diff.parsePatch(patch),
  () => jsdiff.parsePatch(patch),
);
compare(
  "applyPatch",
  () => Bun.diff.applyPatch(a, patch),
  () => jsdiff.applyPatch(a, patch),
);
compare(
  "words",
  () => Bun.diff.words(oldLine, newLine),
  () => jsdiff.diffWordsWithSpace(oldLine, newLine),
);
compare(
  "chars",
  () => Bun.diff.chars(oldLine, newLine),
  () => jsdiff.diffChars(oldLine, newLine),
);
compare(
  "arrays, 1,000 strings",
  () => Bun.diff.arrays(oldArray, newArray),
  () => jsdiff.diffArrays(oldArray, newArray),
);
compare(
  "arrays, 8 strings",
  () => Bun.diff.arrays(oldLine.split(" "), newLine.split(" ")),
  () => jsdiff.diffArrays(oldLine.split(" "), newLine.split(" ")),
);

await run();
