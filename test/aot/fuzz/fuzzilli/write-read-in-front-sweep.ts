// A variable of an ES module is read in front of its declaration, by a road that leads back into the module: the road, times what is asked at its end, times the variable, times who asks, times whether another
// file imports the variable, times the kind of file. Each program is a graph of a few small files and is built alone.
//
//   bun write-read-in-front-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<road>--<asked>--<variable>--<who>--<elsewhere>.ts or .mjs
//   bun write-read-in-front-sweep.ts count
//   bun write-read-in-front-sweep.ts named <pattern> <folder> [most]
//
// The files of a program stand in one file, each behind a line `// @filename: ./<path>`. The first line, `// @entry: ./<path>`, names the file that what follows it is to be laid out as: the entry, to which
// the other files lead back by that name.
//
// `const` and `let` cannot be read until their declaration has run: whoever tries gets a ReferenceError. A module that has begun and not ended can be reached from outside, by `require()` of its path, through
// its own namespace, through a barrel, and its functions can be called then. A compiler that has seen every read of a variable stand behind its declaration may leave the test out and keep the variable as a
// bare number. It has to have seen every road.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

// What the asking file imports, and the expression that gives the namespace of `main`. EXT is the kind of file.
const roads: [string, string, string, [string, string][], string][] = [
  ["required", "", 'require("./main.EXT")', [], ""],
  ["required-under-a-made-name", "", 'require(["./ma", "in.EXT"].join(""))', [], ""],
  ["by-the-require-of-import-meta", "", 'import.meta.require("./main.EXT")', [], ""],
  ["by-the-require-of-import-meta-under-a-made-name", "", 'import.meta.require(["./ma", "in.EXT"].join(""))', [], ""],
  [
    "by-a-require-that-was-made",
    'import { createRequire } from "node:module";',
    'createRequire(import.meta.url)("./main.EXT")',
    [],
    "",
  ],
  ["its-namespace-imported", 'import * as self from "./main.EXT";', "self", [], ""],
  [
    "through-a-barrel",
    'import * as self from "./barrel.EXT";',
    "self",
    [["barrel.EXT", 'export * from "./main.EXT";']],
    "",
  ],
  [
    "by-a-function-made-of-a-text",
    "",
    'new Function("r", "p", "return r(p)")(require, import.meta.dir + "/main.EXT")',
    [],
    "",
  ],
  [
    "its-namespace-handed-on-by-itself",
    'import { me } from "./main.EXT";',
    "me",
    [],
    'export * as me from "./main.EXT";',
  ],
];

const askeds: [string, string][] = [
  ["its-function-is-called", "found.readHere()"],
  ["the-variable-is-read", "found.late"],
  ["its-function-is-called-under-a-made-key", "found[JSON.parse('\"readHere\"')]()"],
  ["the-variable-is-read-under-a-made-key", "found[JSON.parse('\"late\"')]"],
  ["its-names-are-listed", "Object.keys(found).join()"],
];

// The declaration in .ts, and in .mjs.
const variables: [string, string, string][] = [
  [
    "a-number-that-the-run-chooses",
    "export const late: number = Date.now() > 0 ? 5 : 6;",
    "export const late = Date.now() > 0 ? 5 : 6;",
  ],
  ["a-written-number", "export const late = 7;", "export const late = 7;"],
  ["a-let", "export let late = 7;", "export let late = 7;"],
  [
    "a-fraction",
    "export const late: number = Date.now() > 0 ? 5.5 : 6.5;",
    "export const late = Date.now() > 0 ? 5.5 : 6.5;",
  ],
  ["a-text", 'export const late = "text";', 'export const late = "text";'],
  ["a-record", "export const late = { a: 1 };", "export const late = { a: 1 };"],
  ["a-var", "export var late = 7;", "export var late = 7;"],
];

const whos = ["a-file-that-the-entry-imports-first", "the-entry-itself"] as const;

const elsewheres = ["no-other-file-imports-it", "another-file-imports-it"] as const;

const files = ["ts", "mjs"] as const;

const all = roads.length * askeds.length * variables.length * whos.length * elsewheres.length * files.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [road, imports, reaches, more, inMain] = pick(roads);
  const [asked, asks] = pick(askeds);
  const [variable, typed, untyped] = pick(variables);
  const who = pick(whos);
  const elsewhere = pick(elsewheres);
  const ext = pick(files);
  const ts = ext === "ts";
  const kind = (text: string) => text.replaceAll("EXT", ext);
  const world = ts ? "(globalThis as any)" : "globalThis";
  const asking = [
    `let first = "none";`,
    "try {",
    `  const found${ts ? ": any" : ""} = ${kind(reaches)};`,
    "  try {",
    `    first = "value " + String(${asks});`,
    "  } catch (error) {",
    '    first = error instanceof ReferenceError ? "dead" : "other";',
    "  }",
    "} catch {",
    '  first = "refused";',
    "}",
  ].join("\n");
  const body = [ts ? typed : untyped, `export function readHere()${ts ? ": unknown" : ""} {\n  return late;\n}`].join(
    "\n",
  );
  const user = elsewhere === "another-file-imports-it";
  const file = (name: string, lines: string) => [`// @filename: ./${kind(name)}`, kind(lines)];
  const early = who === "a-file-that-the-entry-imports-first";
  const text = [
    kind("// @entry: ./main.EXT"),
    early ? kind('import "./early.EXT";') : kind(imports),
    user && kind('import "./user.EXT";'),
    kind(inMain),
    !early && asking,
    body,
    `console.log("SAID " + ${early ? `${world}.whatWasFoundFirst` : "first"} + " " + String(readHere())${user ? ` + " " + String(${world}.later())` : ""});`,
    ...(early ? file("early.EXT", [imports, asking, `${world}.whatWasFoundFirst = first;`, "export {};"].filter(Boolean).join("\n")) : []), // prettier-ignore
    ...(user ? file("user.EXT", `import { late } from "./main.EXT";\n${world}.later = () => late;`) : []),
    ...more.flatMap(([name, lines]) => file(name, lines)),
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${road}--${asked}--${variable}--${who}--${elsewhere}.${ext}`, text: text + "\n" };
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
