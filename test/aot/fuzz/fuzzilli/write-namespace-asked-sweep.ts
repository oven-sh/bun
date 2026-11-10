// A namespace object is asked for what it holds: what is asked, times how the program comes by the namespace, times how the name gets into it, times the file that the name comes from, times whether anybody
// reads the name by itself. Each program is a graph of a few small files and is built alone.
//
//   bun write-namespace-asked-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<asked>--<come by>--<handed on>--<last file>--<elsewhere>.mjs
//   bun write-namespace-asked-sweep.ts count
//   bun write-namespace-asked-sweep.ts named <pattern> <folder> [most]
//
// The files of a program stand in one file, each behind a line `// @filename: ./<path>`; what stands in front of the first such line is the entry.
//
// A build that leaves out what nobody reads has to know what reads. `kit.size` reads one name. `Object.keys(kit)` lists them all, and so do `for (const k in kit)`, a spread, `JSON.stringify(kit)` and
// `Object.entries(kit)`, some of which read the values too and some of which do not. A name that reaches the namespace through a star and comes out of a CommonJS file is found only when that file has run.
import { mkdirSync, writeFileSync } from "fs";

const askeds: [string, string][] = [
  [
    "for-in-that-reads-nothing",
    'const names = [];\nfor (const k in kit) names.push(k);\nconsole.log(names.join(" "));',
  ],
  [
    "for-in-that-ends-at-once",
    "function isEmpty(o) {\n  for (const k in o) return false;\n  return true;\n}\nconsole.log(isEmpty(kit));",
  ],
  [
    "for-in-that-reads",
    'const seen = [];\nfor (const k in kit) seen.push(k + "=" + typeof kit[k]);\nconsole.log(seen.join(" "));',
  ],
  ["object-keys", 'console.log(Object.keys(kit).join(" "));'],
  ["own-property-names", 'console.log(Object.getOwnPropertyNames(kit).join(" "));'],
  ["reflect-own-keys", 'console.log(Reflect.ownKeys(kit).map(String).join(" "));'],
  ["entries", 'console.log(Object.entries(kit).map(([k, v]) => k + "=" + typeof v).join(" "));'],
  ["values", 'console.log(Object.values(kit).map(v => typeof v).join(" "));'],
  ["made-a-text-of-json", "console.log(JSON.stringify(kit));"],
  ["spread", 'console.log(Object.keys({ ...kit }).join(" "));'],
  ["is-the-name-in-it", 'console.log("size" in kit, "other" in kit, "none" in kit);'],
  ["the-descriptor-of-the-name", 'console.log(typeof Object.getOwnPropertyDescriptor(kit, "size")?.value);'],
  ["has-it-the-name-of-its-own", 'console.log(Object.hasOwn(kit, "size"), Object.hasOwn(kit, "other"));'],
  ["read-under-a-made-key", "console.log(typeof kit[JSON.parse('\"size\"')]);"],
  ["assigned-to-a-record", 'console.log(Object.keys(Object.assign({}, kit)).join(" "));'],
  ["all-descriptors", 'console.log(Object.keys(Object.getOwnPropertyDescriptors(kit)).join(" "));'],
];

// What stands in front of ASK, and whether ASK stands in a function.
const comeBys: [string, string, boolean, [string, string][]][] = [
  ["imported-whole", 'import * as kit from "./index.mjs";', false, []],
  ["imported-at-run-time", 'const kit = await import("./index.mjs");', false, []],
  ["required", 'const kit = require("./index.mjs");', false, []],
  [
    "handed-on-as-a-name",
    'import { kit } from "./door.mjs";',
    false,
    [["door.mjs", 'export * as kit from "./index.mjs";']],
  ],
  ["handed-to-a-function", 'import * as whole from "./index.mjs";', true, []],
];

// LAST is the file that the name comes from.
const handedOns: [string, string][] = [
  ["a-name-beside-a-star", 'export { size } from "LAST";\nexport * from "./other.mjs";'],
  ["a-name-alone", 'export { size } from "LAST";'],
  ["a-star-beside-a-star", 'export * from "LAST";\nexport * from "./other.mjs";'],
  [
    "imported-and-exported-beside-a-star",
    'import { size } from "LAST";\nexport { size };\nexport * from "./other.mjs";',
  ],
  ["under-another-name-beside-a-star", 'export { size as width } from "LAST";\nexport * from "./other.mjs";'],
  ["its-default-beside-a-star", 'export { default as size } from "LAST";\nexport * from "./other.mjs";'],
];

const lastFiles: [string, string, string][] = [
  ["a-function-with-the-name-on-it", "fn.cjs", "module.exports = function () {};\nmodule.exports.size = 5;"],
  ["the-name-assigned-to-exports", "fn.cjs", "exports.size = 5;"],
  ["a-record-on-module-exports", "fn.cjs", "module.exports = { size: 5 };"],
  ["a-class-with-a-static-name", "fn.cjs", "module.exports = class {\n  static size = 5;\n};"],
  ["an-es-module", "fn.mjs", "export const size = 5;\nexport default 6;"],
  [
    "marked-as-an-es-module",
    "fn.cjs",
    'Object.defineProperty(exports, "__esModule", { value: true });\nexports.size = 5;\nexports.default = 6;',
  ],
];

const elsewheres = ["nobody-reads-the-name", "the-entry-reads-it-behind", "another-file-reads-it"] as const;

const all = askeds.length * comeBys.length * handedOns.length * lastFiles.length * elsewheres.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [asked, asks] = pick(askeds);
  const [comeBy, comes, inAFunction, more] = pick(comeBys);
  const [handedOn, hands] = pick(handedOns);
  const [lastFile, path, holds] = pick(lastFiles);
  const elsewhere = pick(elsewheres);
  const file = (name: string, lines: string) => [`// @filename: ./${name}`, lines];
  const text = [
    elsewhere === "another-file-reads-it" && 'import "./user.mjs";',
    comes,
    inAFunction ? `function ask(kit) {\n  ${asks.replaceAll("\n", "\n  ")}\n}\nask(whole);` : asks,
    elsewhere === "the-entry-reads-it-behind" && `console.log(typeof ${inAFunction ? "whole" : "kit"}.size);`,
    ...file("index.mjs", 'export * from "./core.mjs";\nexport const too = 2;'),
    ...file("core.mjs", hands.replace("LAST", `./${path}`)),
    ...file(path, holds),
    ...file("other.mjs", "export const other = 1;"),
    ...more.flatMap(([name, lines]) => file(name, lines)),
    ...(elsewhere === "another-file-reads-it"
      ? file("user.mjs", 'import * as again from "./index.mjs";\nconsole.log("user", typeof again.size);')
      : []),
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${asked}--${comeBy}--${handedOn}--${lastFile}--${elsewhere}.mjs`, text: text + "\n" };
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
