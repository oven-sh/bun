// A program takes another file and asks something of what it was handed: what the other file is, times the kind of the entry and how it takes the file, times what is asked, times what else the program holds. Each
// program holds one of each and is built alone.
//
//   bun write-taken-module-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<file>--<entry>--<taken>--<asked>--<beside>.cjs, .mjs or .ts
//   bun write-taken-module-sweep.ts count
//   bun write-taken-module-sweep.ts named <pattern> <folder> [most]
//
// A program is one text: `// @filename: ./shelf.mjs` begins another file. One load is awaited before the next begins, so that none is in flight beside another.
//
// What `require()` hands out of an ES file bears `__esModule`, and the helpers that compilers lay round a `require()` ask for just that.
import { mkdirSync, writeFileSync } from "fs";

// The kind of the file, its text, and further files.
const shelves: [string, "mjs" | "cjs", string, string][] = [
  ["an-empty-es-file", "mjs", "export {};", ""],
  ["an-es-file-with-a-default", "mjs", "export default 7;", ""],
  ["an-es-file-with-names", "mjs", "export const width = 3;\nexport function area() {\n  return 9;\n}", ""],
  ["an-es-file-with-both", "mjs", "export const width = 3;\nexport default 7;", ""],
  [
    "an-es-file-that-hands-on-a-star",
    "mjs",
    'export * from "./deep.mjs";',
    '// @filename: ./deep.mjs\nexport const depth = 2;\nexport default "deep";',
  ],
  ["an-es-file-whose-default-is-a-class", "mjs", "export default class Shelf {\n  static made = 1;\n}", ""],
  ["an-es-file-that-exports-the-mark-itself", "mjs", 'export const __esModule = "its own";\nexport default 7;', ""],
  [
    "an-es-file-with-a-variable-that-changes",
    "mjs",
    "export let width = 0;\nexport function widen() {\n  width++;\n}\nwiden();",
    "",
  ],
  ["a-commonjs-file-with-fields", "cjs", "exports.width = 3;\nexports.area = () => 9;", ""],
  [
    "a-commonjs-file-that-is-a-function",
    "cjs",
    "module.exports = function shelf() {\n  return 9;\n};\nmodule.exports.width = 3;",
    "",
  ],
  [
    "a-commonjs-file-with-the-mark",
    "cjs",
    'Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = 7;\nexports.width = 3;',
    "",
  ],
  ["a-commonjs-file-that-is-a-number", "cjs", "module.exports = 7;", ""],
];

// The kind of the entry, what stands at its top, and what gives `taken`. SHELF is the path of the other file.
const requires = 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);';
const byCalls: [string, string][] = [
  ["required", "const taken = require(SHELF);"],
  [
    "required-twice",
    'const first = require(SHELF);\nconst taken = require(SHELF);\nconsole.log("SAID the same twice", first === taken);',
  ],
  ["imported-at-run-time", "const taken = await import(SHELF);"],
  ["imported-and-then-required", "await import(SHELF);\nconst taken = require(SHELF);"],
  ["required-and-then-imported", "require(SHELF);\nconst taken = await import(SHELF);"],
];
const takes: [string, string, string, string][] = [
  ...byCalls.map(([name, code]): [string, string, string, string] => ["cjs", name, "", code]),
  ...(["mjs", "ts"] as const).flatMap((entry): [string, string, string, string][] => [
    ...byCalls.map(([name, code]): [string, string, string, string] => [entry, name, requires, code]),
    [entry, "the-whole-imported", "import * as whole from SHELF;", "const taken = whole;"],
    [entry, "the-whole-imported-and-required", `import * as whole from SHELF;\n${requires}`, 'const taken = require(SHELF);\nconsole.log("SAID the same as the import", whole === taken);'], // prettier-ignore
  ]),
];

const askeds: [string, string][] = [
  ["its-kind", "typeof taken"],
  ["its-keys", "Object.keys(Object(taken)).sort().join()"],
  ["all-its-own-names", "Reflect.ownKeys(Object(taken)).map(String).sort().join()"],
  ["the-mark", "String(taken.__esModule)"],
  ["whether-the-mark-is-undefined", "taken.__esModule === undefined"],
  ["whether-the-mark-is-true", "taken.__esModule === true"],
  ["a-choice-by-the-mark", 'taken.__esModule ? "marked" : "not marked"'],
  ["whether-the-mark-is-in-it", '"__esModule" in Object(taken)'],
  ["how-the-mark-is-laid", 'JSON.stringify(Object.getOwnPropertyDescriptor(Object(taken), "__esModule") ?? null)'],
  ["its-default", "show(taken.default)"],
  ["its-default-through-a-helper", "show((one => (one && one.__esModule ? one : { default: one }))(taken).default)"],
  ["its-names-through-a-helper", "Object.keys(\n  (one => {\n    if (one && one.__esModule) return one;\n    const copy = {};\n    if (one != null) for (const key in one) if (key !== \"default\" && Object.prototype.hasOwnProperty.call(one, key)) copy[key] = one[key];\n    copy.default = one;\n    return copy;\n  })(taken),\n)\n  .sort()\n  .join()"], // prettier-ignore
  ["made-a-text", "Object.prototype.toString.call(taken)"],
  ["made-json", 'JSON.stringify(taken) ?? "nothing"'],
  [
    "whether-it-may-grow",
    "[Object.isExtensible(Object(taken)), Object.isSealed(Object(taken)), Object.isFrozen(Object(taken))].join()",
  ],
  ["spread", "Object.keys({ ...taken }).sort().join()"],
  [
    "taken-apart",
    '(({ default: first, width, ...rest }) => [show(first), show(width), Object.keys(rest).sort().join()].join("|"))(Object(taken))',
  ],
];

const besides: [string, string][] = [
  ["nothing", ""],
  ["the-program-holds-eval", 'if (globalThis.never) eval("0");'],
  ["the-program-makes-a-function-of-a-text", 'if (globalThis.never) new Function("return 0")();'],
];

const all = shelves.length * takes.length * askeds.length * besides.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [asked, asks] = pick(askeds);
  const [shelf, kind, holds, further] = pick(shelves);
  const [entry, taken, atTheTop, takesIt] = pick(takes);
  const [beside, alsoHolds] = pick(besides);
  const text = [
    // The questions are asked of a value of any kind.
    entry === "ts" && "// @ts-nocheck",
    atTheTop,
    'const show = one => (typeof one === "function" ? "a function" : typeof one === "object" && one !== null ? JSON.stringify(one) : String(one));',
    alsoHolds,
    "async function main() {",
    "  " + indented(takesIt, "  "),
    `  console.log("SAID", ${indented(asks, "  ")});`,
    "}",
    'main().catch(error => console.log("SAID threw", error.name));',
    `// @filename: ./shelf.${kind}`,
    holds,
    further,
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("SHELF", JSON.stringify(`./shelf.${kind}`));
  return { name: `${shelf}--${entry}--${taken}--${asked}--${beside}.${entry}`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
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
