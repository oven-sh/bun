// A few small files that hand names on to each other: how the first file reaches the barrel, times what it imports beside it, times how deep the barrel lies, times what the level with two re-exports holds,
// times what the last file exports, times the kind of file. Each program holds one of each and is built alone.
//
//   bun write-barrel-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<reached>--<beside>--<depth>--<level>--<leaf>.ts | .tsx | .js
//   bun write-barrel-sweep.ts count
//   bun write-barrel-sweep.ts named <pattern> <folder> [most]
//
// A program is one file: the first file's text, and behind each line `// @filename: ./<name>` the text of another. Whoever checks several files at once and lets go of what it has read of a file as soon as
// nobody needs it has to know who will still ask: a barrel with two stars asks about every file that came before it. Such a mistake shows now and then, and most often where the threads of a build share one
// processor, so these are worth building several times, pinned to one. What they print is worth holding against `bun <file>` too: which names a barrel has, and in which order.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

// SEEN is what the file imports beside the barrel, NAME a name that the barrel has.
const reaches: [string, string][] = [
  ["required", 'console.log(SEEN Object.keys(require("./b")));'],
  ["required-in-a-function", 'function load() {\n  return require("./b");\n}\nconsole.log(SEEN Object.keys(load()));'],
  ["imported-at-run-time", 'console.log(SEEN Object.keys(await import("./b")));'],
  ["imported-whole", 'import * as all from "./b";\nconsole.log(SEEN Object.keys(all));'],
  ["imported-by-name", 'import { NAME } from "./b";\nconsole.log(SEEN typeof NAME);'],
  ["handed-on", 'export * from "./b";\nconsole.log(SEEN 1);'],
];

// What the first file imports, what it prints of that, and the files that this needs.
const besides: [string, string, string, [string, string][]][] = [
  ["a-name-of-another-file", 'import { look } from "./look";', "look,", [["look", "export const look = 1;"]]],
  ["nothing", "", "", []],
  [
    "names-of-two-other-files",
    'import { look } from "./look";\nimport { more } from "./more";',
    "look, more,",
    [
      ["look", "export const look = 1;"],
      ["more", "export const more = 2;"],
    ],
  ],
  [
    "a-name-of-a-file-that-reaches-the-last-file-too",
    'import { look } from "./look";',
    "look,",
    [["look", 'import * as last from "./g";\nexport const look = Object.keys(last).length;']],
  ],
];

// The files between the first file and the level.
const depths: [string, [string, string][]][] = [
  ["one-barrel-above", [["b", 'export * from "./c";']]],
  [
    "two-barrels-above",
    [
      ["b", 'export * from "./a";'],
      ["a", 'export * from "./c";'],
    ],
  ],
  ["a-barrel-above-that-names-it-whole", [["b", 'export * as inner from "./c";']]],
];

// The level `c`, its two files `d` and `e`, and a name that a barrel of stars above it has.
const levels: [string, string, string, string, string][] = [
  [
    "two-stars-of-twins-that-name-the-last-file-whole",
    'export * from "./d";\nexport * from "./e";',
    'export * as ns from "./g";',
    'export * as ns from "./g";',
    "ns",
  ],
  [
    "two-stars-of-one-name",
    'export * from "./d";\n// @ts-ignore\nexport * from "./e";',
    'export { w } from "./g";',
    "export const w = 2;",
    "w",
  ],
  [
    "two-stars-of-two-names",
    'export * from "./d";\nexport * from "./e";',
    'export { w } from "./g";',
    "export const other = 2;",
    "w",
  ],
  ["a-diamond", 'export * from "./d";\nexport * from "./e";', 'export * from "./g";', 'export * from "./g";', "w"],
  ["one-star", 'export * from "./d";', 'export * from "./g";', "export const unused = 0;", "w"],
  [
    "a-star-and-a-name",
    'export * from "./d";\nexport { w } from "./g";',
    "export const other = 2;",
    "export const unused = 0;",
    "w",
  ],
];

const leaves: [string, string][] = [
  ["a-constant", "export const w = 1;"],
  ["a-function", "export function w() {\n  return 1;\n}"],
  ["a-class", "export class w {}"],
  ["a-constant-and-a-default", "export const w = 1;\nexport default 2;"],
];

const files = ["ts", "tsx", "js"] as const;

const all = reaches.length * besides.length * depths.length * levels.length * leaves.length * files.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [reached, first] = pick(reaches);
  const [beside, imports, seen, others] = pick(besides);
  const [depth, above] = pick(depths);
  const [level, c, d, e, name] = pick(levels);
  const [leaf, g] = pick(leaves);
  const file = pick(files);
  const has = depth === "a-barrel-above-that-names-it-whole" ? "inner" : name;
  const main = [imports, first.replaceAll("SEEN ", seen ? seen + " " : "").replaceAll("NAME", has)]
    .filter(Boolean)
    .join("\n");
  const rest: [string, string][] = [...others, ...above, ["c", c], ["d", d], ["e", e], ["g", g]];
  const text = main + "\n" + rest.map(([path, held]) => `// @filename: ./${path}.${file}\n${held}\n`).join("");
  return { name: `${reached}--${beside}--${depth}--${level}--${leaf}.${file}`, text };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
  }
  console.log(Math.min(count, all));
}
