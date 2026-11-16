// A file takes a CommonJS file and calls a function that it exports, turn after turn: where the `require()` stands, times how the other file fills the name, times what has happened to the other file before. Each
// program holds one of each and is built alone.
//
//   bun write-required-in-a-turn-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<where>--<filled>--<before>.cjs or .mjs
//   bun write-required-in-a-turn-sweep.ts count
//   bun write-required-in-a-turn-sweep.ts named <pattern> <folder> [most]
//
// A program is one text: `// @filename: ./tool.cjs` begins another file.
//
// A second `require()` of a file hands out what the first one did, and a name that is stored twice holds what was stored last.
import { mkdirSync, writeFileSync } from "fs";

const turns = 'Number("3")';

// The kind of the main file, what stands at its top, what stands in front of the loop, what opens the loop, the turn, and what closes the loop. TAKE takes the other file, FRONT is what the third part of a
// program's name asks for.
const wheres: [string, "cjs" | "mjs", string, string, string, string, string][] = [
  [
    "in-front",
    "cjs",
    "",
    "const tool = TAKE;",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "total += tool.name(turn);",
    "}",
  ],
  [
    "in-the-turn-of-a-for",
    "cjs",
    "",
    "",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "const tool = TAKE;\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-the-turn-of-a-while",
    "cjs",
    "",
    "let turn = 0;",
    `while (turn < ${turns}) {`,
    "const tool = TAKE;\ntotal += tool.name(turn);\nturn++;",
    "}",
  ],
  [
    "in-the-turn-of-a-do-while",
    "cjs",
    "",
    "let turn = 0;",
    "do {",
    "const tool = TAKE;\ntotal += tool.name(turn);",
    `} while (++turn < ${turns});`,
  ],
  [
    "in-the-turn-of-a-for-of",
    "cjs",
    "",
    "",
    "for (const turn of [0, 1, 2]) {",
    "const tool = TAKE;\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-the-turn-of-a-for-in",
    "cjs",
    "",
    "",
    "for (const turn in [0, 1, 2]) {",
    "const tool = TAKE;\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-a-callback-of-for-each",
    "cjs",
    "",
    "",
    "[0, 1, 2].forEach(turn => {",
    "const tool = TAKE;\ntotal += tool.name(turn);",
    "});",
  ],
  [
    "the-member-called-straight-off-it",
    "cjs",
    "",
    "",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "total += TAKE.name(turn);",
    "}",
  ],
  [
    "taken-apart-in-the-turn",
    "cjs",
    "",
    "",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "const { name } = TAKE;\ntotal += name(turn);",
    "}",
  ],
  [
    "into-a-variable-from-in-front",
    "cjs",
    "",
    "let tool;",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "tool = TAKE;\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-the-first-turn-alone",
    "cjs",
    "",
    "let tool;",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "tool ??= TAKE;\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-a-function-called-from-the-turn",
    "cjs",
    "",
    "function take() {\n  return TAKE;\n}",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "const tool = take();\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-a-loop-in-a-function",
    "cjs",
    "",
    "function work() {",
    `  for (let turn = 0; turn < ${turns}; turn++) {`,
    "  const tool = TAKE;\n  total += tool.name(turn);",
    "  }\n}\nwork();",
  ],
  [
    "in-the-inner-of-two-loops",
    "cjs",
    "",
    "",
    `for (let turn = 0; turn < ${turns}; turn++) {\n  for (let inner = 0; inner < 2; inner++) {`,
    "  const tool = TAKE;\n  total += tool.name(turn + inner);",
    "  }\n}",
  ],
  [
    "in-an-es-file-by-a-require-that-it-made",
    "mjs",
    'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
    "",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "const tool = TAKE;\ntotal += tool.name(turn);",
    "}",
  ],
  [
    "in-an-es-file-by-an-import-at-run-time",
    "mjs",
    "",
    "",
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    "const tool = (AWAITED).default;\ntotal += tool.name(turn);",
    "}",
  ],
];

const first = 'turn => "first" + turn';
const second = 'turn => "second" + turn';
const filleds: [string, string][] = [
  ["once", `exports.name = ${second};`],
  ["twice", `exports.name = ${first};\nexports.name = ${second};`],
  ["three-times", `exports.name = ${first};\nexports.name = turn => "middle" + turn;\nexports.name = ${second};`],
  [
    "twice-by-functions-with-names",
    'exports.name = function early(turn) {\n  return "first" + turn;\n};\nexports.name = function late(turn) {\n  return "second" + turn;\n};',
  ],
  ["the-second-time-under-an-if-that-holds", `exports.name = ${first};\nif (Number("1")) exports.name = ${second};`],
  [
    "the-second-time-under-an-if-that-does-not-hold",
    `exports.name = ${first};\nif (Number("0")) exports.name = ${second};`,
  ],
  ["twice-on-module-exports", `module.exports.name = ${first};\nmodule.exports.name = ${second};`],
  ["once-on-each", `exports.name = ${first};\nmodule.exports.name = ${second};`],
  ["with-void-first", `exports.name = void 0;\nexports.name = ${second};`],
  ["with-a-number-first", `exports.name = 7;\nexports.name = ${second};`],
  [
    "by-a-function-that-replaces-itself",
    `exports.name = turn => {\n  exports.name = ${second};\n  return "first" + turn;\n};`,
  ],
  ["by-a-getter", `Object.defineProperty(exports, "name", { enumerable: true, get: () => ${second} });`],
  [
    "by-a-getter-that-gives-another-each-time",
    `let asked = 0;\nObject.defineProperty(exports, "name", { enumerable: true, get: () => (asked++ % 2 ? ${second} : ${first}) });`,
  ],
  ["by-one-of-two", `exports.name = Number("1") ? ${second} : ${first};`],
  [
    "in-a-record-that-replaces-the-exports-twice",
    `module.exports = { name: ${first} };\nmodule.exports = { name: ${second} };`,
  ],
  ["under-a-reckoned-key-and-then-by-name", `exports["na" + "me"] = ${first};\nexports.name = ${second};`],
  ["by-assign-and-then-by-name", `Object.assign(exports, { name: ${first} });\nexports.name = ${second};`],
  ["twice-and-deleted-between", `exports.name = ${first};\ndelete exports.name;\nexports.name = ${second};`],
];

const throwsOnce = 'if (!globalThis.ranBefore) {\n  globalThis.ranBefore = true;\n  throw new Error("at first");\n}\n';
// What stands in front in the main file, what stands at the top of the other file, further files, and whether the turn catches.
const befores: [string, string, string, string, boolean][] = [
  ["has-not-run", "", "", "", false],
  ["has-run", "EARLY;", "", '// @filename: ./early.cjs\nrequire("./tool.cjs");', false],
  ["has-been-taken-in-front-for-nothing", "TAKEN;", "", "", false],
  ["has-thrown-once", 'try {\n  TAKEN;\n} catch {\n  total += "threw;";\n}', throwsOnce, "", false],
  ["throws-in-the-first-turn", "", throwsOnce, "", true],
  [
    "is-in-a-cycle",
    "",
    'require("./other.cjs");\n',
    '// @filename: ./other.cjs\nconst tool = require("./tool.cjs");\nglobalThis.early = typeof tool.name;',
    false,
  ],
];

const all = wheres.length * filleds.length * befores.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [filled, fills] = pick(filleds);
  const [where, kind, atTheTop, inFront, opens, turn, closes] = pick(wheres);
  const [before, front, atTheTopOfTheOther, further, catches] = pick(befores);
  const imports = where === "in-an-es-file-by-an-import-at-run-time";
  const deeper = /^ {2}/.test(turn) ? "    " : "  ";
  const body = turn.replace(/^ {2}/gm, "");
  const text = [
    atTheTop,
    'let total = "";',
    front,
    inFront,
    opens,
    deeper + indented(catches ? `try {\n  ${indented(body, "  ")}\n} catch {\n  total += "threw;";\n}` : body, deeper),
    closes,
    'console.log("SAID " + total + " " + globalThis.early);',
    "// @filename: ./tool.cjs",
    atTheTopOfTheOther + fills,
    further,
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("EARLY", imports ? 'await import("./early.cjs")' : 'require("./early.cjs")')
    .replaceAll("TAKEN", imports ? 'await import("./tool.cjs")' : 'require("./tool.cjs")')
    .replaceAll("AWAITED", 'await import("./tool.cjs")')
    .replaceAll("TAKE", 'require("./tool.cjs")');
  return { name: `${where}--${filled}--${before}.${kind}`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
