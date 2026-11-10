// A variable that a file exports is reckoned with and handed to a small helper: how the variable is exported, times how the namespace of its file is used, times the reckoning, times the helper, times the
// method that the helper calls, untyped and with written types. Each program holds one of each and as good as nothing else, and is built alone.
//
//   bun write-exported-variable-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<export>--<namespace>--<operand>--<helper>--<method>.js | .ts
//   bun write-exported-variable-sweep.ts count
//   bun write-exported-variable-sweep.ts named <pattern> <folder> [most]
//
// A program is one file: the first file's text, and behind the line `// @filename: ./t.<kind>` the text of the file that exports. A variable that is exported and may be written is no constant, and where
// the namespace of its file is used as a value, code that nobody has seen may read it at any time. What a compiler believes of such a variable goes with it into the helper that is copied in line. The
// program prints what the function answers, changes the variable where the language lets it, and prints again.
import { mkdirSync, writeFileSync } from "fs";

// What the file declares, whether the file itself may write the variable, and whether others may through `set`.
const exported: [string, string, boolean, boolean][] = [
  ["an-exported-var", "export var p = 2;", true, false],
  ["a-var-exported-by-a-list", "var p = 2;\nexport { p };", true, false],
  ["a-var-exported-under-another-name", "var p = 2;\nexport { p as q };", true, false],
  ["an-exported-let-with-a-setter", "export let p = 2;\nexport function set(nNUMBER) {\n  p = n;\n}", true, true],
  ["an-exported-let-nobody-else-writes", "export let p = 2;", true, false],
  ["an-exported-constant", "export const p = 2;", false, false],
  ["a-var-that-is-not-exported", "var p = 2;", true, false],
];

// The first file, the head of the file that exports, its tail, and how `f` and `set` are named where they are called. T is the path of the file that exports.
const namespaces: [string, string, string, string, string][] = [
  [
    "the-file-lists-its-own-namespace",
    'import "T";',
    'import * as m from "T";',
    "PRINTS\nconsole.log(Object.keys(m).length);",
    "",
  ],
  [
    "the-file-reads-a-name-off-its-own-namespace",
    'import "T";',
    'import * as m from "T";',
    "PRINTS\nconsole.log(typeof m.f);",
    "",
  ],
  ["another-file-lists-it", 'import * as m from "T";\nPRINTS\nconsole.log(Object.keys(m).length);', "", "", "m."],
  ["another-file-reads-names-off-it", 'import * as m from "T";\nPRINTS', "", "", "m."],
  ["another-file-imports-it-at-run-time", 'const m = await import("T");\nPRINTS', "", "", "m."],
  ["another-file-imports-by-name", 'import { NAMES } from "T";\nPRINTS', "", "", ""],
  ["another-file-requires-it", 'const m = require("T");\nPRINTS', "", "", "m."],
  ["another-file-hands-it-on-whole", 'export * as m from "T";\nimport { NAMES } from "T";\nPRINTS', "", "", ""],
];

const operands: [string, string][] = [
  ["plus-one", "p + 1"],
  ["minus-one", "p - 1"],
  ["itself", "p"],
  ["times-two", "p * 2"],
  ["or-one", "p | 1"],
  ["plus-true", "p + true"],
  ["negated-twice", "- -p"],
  ["plus-a-fraction", "p + 0.5"],
];

// What is declared, and the call. CALL is the method's call on v with b and e.
const helpers: [string, string, string][] = [
  ["a-helper-of-two-parameters", "function h(vTEXT, eNUMBER) {\n  const b = 0;\n  return CALL;\n}", "h(c, OPERAND)"],
  ["a-helper-with-a-written-start", "function h(vTEXT, eNUMBER) {\n  return WRITTEN;\n}", "h(c, OPERAND)"],
  ["a-helper-of-three-parameters", "function h(vTEXT, bNUMBER, eNUMBER) {\n  return CALL;\n}", "h(c, 0, OPERAND)"],
  ["an-exported-helper", "export function h(vTEXT, eNUMBER) {\n  return WRITTEN;\n}", "h(c, OPERAND)"],
  ["an-arrow", "const h = (vTEXT, eNUMBER) => WRITTEN;", "h(c, OPERAND)"],
  ["no-helper", "", "INLINE"],
];

const methods: [string, string][] = [
  ["slice", "v.slice(b, e)"],
  ["substring", "v.substring(b, e)"],
  ["substr", "v.substr(b, e)"],
  ["index-of", 'v.indexOf("c", e)'],
  ["char-code-at", "v.charCodeAt(e)"],
  ["at", "v.at(e)"],
  ["pad-end", 'v.padEnd(e + 4, "x")'],
  ["repeat", "v.repeat(e)"],
];

const files = ["js", "ts"] as const;

const all = exported.length * namespaces.length * operands.length * helpers.length * methods.length * files.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [how, declared, mayWrite, hasSetter] = pick(exported);
  const [namespace, first, head, tail, through] = pick(namespaces);
  const [operand, reckoned] = pick(operands);
  const [helper, helps, call] = pick(helpers);
  const [method, called] = pick(methods);
  const file = pick(files);
  const inTheFile = tail !== "";
  const change = inTheFile ? (mayWrite ? "p = 1;" : "") : hasSetter ? `${through}set(1);` : "";
  const prints = [`console.log(${through}f("abcd"));`, change, change && `console.log(${through}f("abcd"));`]
    .filter(Boolean)
    .join("\n");
  const typed = (text: string) =>
    text
      .replaceAll("TEXT", file === "ts" ? ": string" : "")
      .replaceAll("NUMBER", file === "ts" ? ": number" : "")
      .replaceAll('"T"', file === "ts" ? '"./t"' : '"./t.js"');
  const filled = (text: string) => text.replaceAll("PRINTS", prints).replaceAll("NAMES", hasSetter ? "f, set" : "f");
  const written = called.replaceAll("b", "\u0001").replaceAll("\u0001,", "0,").replaceAll("\u0001", "b");
  const answers = call
    .replace("INLINE", written.replaceAll("v.", "c.").replace(/\be\b/g, `(${reckoned})`))
    .replace("OPERAND", reckoned);
  const exporting = [head, declared, helps.replace("CALL", called).replace("WRITTEN", written), `export function f(cTEXT) {\n  return ${answers};\n}`, filled(tail)].filter(Boolean).join("\n"); // prettier-ignore
  return {
    name: `${how}--${namespace}--${operand}--${helper}--${method}.${file}`,
    text: typed(`${filled(first)}\n// @filename: ./t.${file}\n${exporting}\n`),
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
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
