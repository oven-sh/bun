// A file takes a CommonJS file and uses something that it exports, turn after turn, beside write-required-in-a-turn-sweep.ts: where the `require()` stands, times what is exported and what the turn does with it, times
// how the other file fills the name, times what has happened to the other file before. Each program holds one of each and is built alone.
//
//   bun write-used-in-a-turn-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<where>--<used>--<filled>--<before>.cjs or .mjs
//   bun write-used-in-a-turn-sweep.ts count
//   bun write-used-in-a-turn-sweep.ts named <pattern> <folder> [most]
//
// A program is one text: `// @filename: ./tool.cjs` begins another file.
//
// A file runs at the first `require()` of it and not before, so until then nothing that it exports is there.
import { mkdirSync, writeFileSync } from "fs";

const turns = 'Number("3")';
const counted = `for (let turn = 0; turn < ${turns}; turn++) {`;

// The kind of the main file, what stands at its top, what stands in front of the loop, what opens the loop, what stands in the turn in front of the use, how what is used reads there, what stands behind the use, and
// what closes the loop. TAKE takes the other file, NAME is the name that it exports.
const wheres: [string, "cjs" | "mjs", string, string, string, string, string, string, string][] = [
  ["in-front", "cjs", "", "const tool = TAKE;", counted, "", "tool.NAME", "", "}"],
  ["in-the-turn-of-a-for", "cjs", "", "", counted, "const tool = TAKE;", "tool.NAME", "", "}"],
  [
    "in-the-turn-of-a-while",
    "cjs",
    "",
    "let turn = 0;",
    `while (turn < ${turns}) {`,
    "const tool = TAKE;",
    "tool.NAME",
    "turn++;",
    "}",
  ],
  [
    "in-the-turn-of-a-do-while",
    "cjs",
    "",
    "let turn = 0;",
    "do {",
    "const tool = TAKE;",
    "tool.NAME",
    "",
    `} while (++turn < ${turns});`,
  ],
  [
    "in-the-turn-of-a-for-of",
    "cjs",
    "",
    "",
    "for (const turn of [0, 1, 2]) {",
    "const tool = TAKE;",
    "tool.NAME",
    "",
    "}",
  ],
  [
    "in-a-callback-of-for-each",
    "cjs",
    "",
    "",
    "[0, 1, 2].forEach(turn => {",
    "const tool = TAKE;",
    "tool.NAME",
    "",
    "});",
  ],
  ["used-straight-off-it", "cjs", "", "", counted, "", "TAKE.NAME", "", "}"],
  ["taken-apart-in-the-turn", "cjs", "", "", counted, "const { NAME } = TAKE;", "NAME", "", "}"],
  ["into-a-variable-from-in-front", "cjs", "", "let tool;", counted, "tool = TAKE;", "tool.NAME", "", "}"],
  [
    "in-a-function-called-from-the-turn",
    "cjs",
    "",
    "function take() {\n  return TAKE;\n}",
    counted,
    "const tool = take();",
    "tool.NAME",
    "",
    "}",
  ],
  [
    "in-a-loop-in-a-function",
    "cjs",
    "",
    "function work() {",
    "  " + counted,
    "const tool = TAKE;",
    "tool.NAME",
    "",
    "  }\n}\nwork();",
  ],
  [
    "in-an-es-file-by-a-require-that-it-made",
    "mjs",
    'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
    "",
    counted,
    "const tool = TAKE;",
    "tool.NAME",
    "",
    "}",
  ],
  [
    "in-an-es-file-by-an-import-at-run-time",
    "mjs",
    "",
    "",
    counted,
    "const tool = (AWAITED).default;",
    "tool.NAME",
    "",
    "}",
  ],
];

// The name, what is stored first where something is, what is stored last, and what the turn does. IT is how what is used reads in the turn.
const useds: [string, string, string, string, string][] = [
  ["a-function-called", "name", 'turn => "first" + turn', 'turn => "second" + turn', "IT(turn)"],
  ["a-record-asked-whether-it-is-there", "box", "{ size: 1 }", "{ size: 3 }", '(IT ? IT.size + turn : "none")'],
  ["a-field-of-a-record-read", "box", "{ size: 1 }", "{ size: 3 }", "IT.size + turn"],
  ["a-field-of-a-record-that-had-other-fields-first", "box", "{ depth: 1, width: 2 }", "{ size: 3 }", "IT.size + turn"],
  [
    "a-method-of-a-record-called",
    "box",
    '{ say: turn => "first" + turn }',
    '{ say: turn => "second" + turn }',
    "IT.say(turn)",
  ],
  ["a-remainder-by-it", "step", "2", "3", "(turn + 7) % IT"],
  ["a-quotient-by-it-cut-to-an-integer", "step", "2", "3", "((turn + 7) / IT) | 0"],
  ["a-quotient-by-it-floored", "step", "2", "3", "Math.floor((turn + 7) / IT)"],
  ["a-number-added", "step", "2", "3", "IT + turn"],
  ["a-number-compared", "step", "2", "1", '(turn < IT ? "under" : "over")'],
  ["a-text-joined", "word", '"first"', '"second"', "IT + turn"],
  ["an-element-of-a-list", "list", "[1]", "[4, 5, 6]", "IT[turn % IT.length]"],
  ["a-value-of-a-map", "table", 'new Map([[0, "a"]])', 'new Map([[0, "x"], [1, "y"], [2, "z"]])', "IT.get(turn)"],
  [
    "an-object-of-a-class-made",
    "Box",
    'class {\n  constructor(turn) {\n    this.said = "first" + turn;\n  }\n}',
    'class {\n  constructor(turn) {\n    this.said = "second" + turn;\n  }\n}',
    "new (IT)(turn).said",
  ],
];

// FIRST and LAST are what is stored.
const filleds: [string, string][] = [
  ["once", "exports.NAME = LAST;"],
  ["once-out-of-a-constant", "const kept = LAST;\nexports.NAME = kept;"],
  ["twice", "exports.NAME = FIRST;\nexports.NAME = LAST;"],
  ["the-second-time-under-an-if-that-holds", 'exports.NAME = FIRST;\nif (Number("1")) exports.NAME = LAST;'],
  ["the-second-time-under-an-if-that-does-not-hold", 'exports.NAME = LAST;\nif (Number("0")) exports.NAME = FIRST;'],
  ["twice-on-module-exports", "module.exports.NAME = FIRST;\nmodule.exports.NAME = LAST;"],
  ["by-one-of-two", 'exports.NAME = Number("1") ? LAST : FIRST;'],
  ["with-void-first", "exports.NAME = void 0;\nexports.NAME = LAST;"],
  ["in-a-record-that-replaces-the-exports", "module.exports = { NAME: LAST };"],
];

// What stands in front in the main file, what stands at the top of the other file, and further files.
const befores: [string, string, string, string][] = [
  ["has-not-run", "", "", ""],
  ["has-run", "EARLY;", "", '// @filename: ./early.cjs\nrequire("./tool.cjs");'],
  [
    "is-in-a-cycle",
    "",
    'require("./other.cjs");\n',
    '// @filename: ./other.cjs\nconst tool = require("./tool.cjs");\nglobalThis.early = typeof tool.NAME;',
  ],
];

const all = wheres.length * useds.length * filleds.length * befores.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [filled, fills] = pick(filleds);
  const [used, name, first, last, uses] = pick(useds);
  const [where, kind, atTheTop, inFront, opens, binds, it, behind, closes] = pick(wheres);
  const [before, front, atTheTopOfTheOther, further] = pick(befores);
  const imports = where === "in-an-es-file-by-an-import-at-run-time";
  const deeper = opens.startsWith("  ") ? "    " : "  ";
  const turn = [binds, `total += ${uses.replaceAll("IT", () => it)} + ";";`, behind].filter(Boolean).join("\n");
  const text = [
    atTheTop,
    'let total = "";',
    front,
    inFront,
    opens,
    deeper + indented(turn, deeper),
    closes,
    'console.log("SAID " + total + " " + globalThis.early);',
    "// @filename: ./tool.cjs",
    atTheTopOfTheOther + fills.replaceAll("FIRST", () => first).replaceAll("LAST", () => last),
    further,
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("EARLY", imports ? 'await import("./early.cjs")' : 'require("./early.cjs")')
    .replaceAll("AWAITED", 'await import("./tool.cjs")')
    .replaceAll("TAKE", 'require("./tool.cjs")')
    .replaceAll("NAME", name);
  return { name: `${where}--${used}--${filled}--${before}.${kind}`, text: text + "\n" };
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
