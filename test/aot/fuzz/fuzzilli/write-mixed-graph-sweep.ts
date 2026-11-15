// Five small files, modules and CommonJS by turns, that all come to one last module: what stands at the head of the first file, times whether it imports the last module itself, times how it reaches the
// CommonJS file, times how that reaches the module in the middle, times what the middle imports and in which order, times how the second CommonJS file reaches the last module. Each program holds one of each
// and is built alone.
//
//   bun write-mixed-graph-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<head>--<first>--<legacy>--<feature>--<middle>--<built-in>--<order>--<helper>.mjs
//   bun write-mixed-graph-sweep.ts count
//   bun write-mixed-graph-sweep.ts named <pattern> <folder> [most]
//
// A program is one file: the first file's text, and behind each line `// @filename: ./<name>` the text of another. A `require()` of a module has to run it at once, and may, unless the module waits for
// something. A module that the load of the first file has asked for and nobody has begun waits for nothing. Where a `require()` stands in a `try`, a refusal shows only in what is printed.
import { mkdirSync, writeFileSync } from "fs";

const heads: [string, string][] = [
  ["nothing-at-the-head", ""],
  ["a-built-in-at-the-head", 'import "node:fs";'],
  ["another-built-in-at-the-head", 'import "node:path";'],
];

const firsts: [string, string, string][] = [
  ["the-first-file-imports-the-last-too", 'import { shared } from "./shared.mjs";', "shared,"],
  ["the-first-file-does-not", "", ""],
];

const legacies: [string, string][] = [
  ["imported", 'import legacy from "./legacy.cjs";'],
  ["required", 'const legacy = require("./legacy.cjs");'],
  ["imported-at-run-time", 'const { default: legacy } = await import("./legacy.cjs");'],
];

const features: [string, string][] = [
  ["required", 'module.exports = "legacy: " + require("./feature.mjs").feature;'],
  [
    "required-in-a-try",
    'let got = "no feature";\ntry {\n  got = require("./feature.mjs").feature;\n} catch {}\nmodule.exports = "legacy: " + got;',
  ],
];

const middles: [string, string, string][] = [
  ["the-middle-imports-the-last-too", 'import { shared } from "./shared.mjs";', ' + " " + shared'],
  ["the-middle-does-not", "", ""],
];

const builtIns: [string, string, string][] = [
  ["the-file-system", 'import * as fs from "node:fs";', ' + " " + typeof fs.readFileSync'],
  ["paths", 'import * as path from "node:path";', ' + " " + typeof path.join'],
  ["terminals", 'import * as tty from "node:tty";', ' + " " + typeof tty.isatty'],
  ["the-runtime", 'import { version } from "bun";', ' + " " + typeof version'],
  ["no-built-in", "", ""],
];

const orders = ["the-helper-first", "the-helper-last"] as const;

const helpers: [string, string][] = [
  [
    "required-in-a-try",
    'let got = "the fallback";\ntry {\n  got = require("./shared.mjs").shared;\n} catch {}\nmodule.exports = "helper: " + got;',
  ],
  ["required", 'module.exports = "helper: " + require("./shared.mjs").shared;'],
  [
    "required-in-a-function",
    'function load() {\n  return require("./shared.mjs").shared;\n}\nmodule.exports = "helper: " + load();',
  ],
];

const all =
  heads.length *
  firsts.length *
  legacies.length *
  features.length *
  middles.length *
  builtIns.length *
  orders.length *
  helpers.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [head, atTheHead] = pick(heads);
  const [first, importsLast, printsLast] = pick(firsts);
  const [legacy, reachesLegacy] = pick(legacies);
  const [feature, legacyText] = pick(features);
  const [middle, middleImports, middleAdds] = pick(middles);
  const [builtIn, builtInImport, builtInAdds] = pick(builtIns);
  const order = pick(orders);
  const [helper, helperText] = pick(helpers);
  const main = [
    atTheHead,
    importsLast,
    reachesLegacy,
    `console.log("main:", ${printsLast ? printsLast + " " : ""}legacy);`,
  ]
    .filter(Boolean)
    .join("\n");
  const importsHelper = 'import helper from "./helper.cjs";';
  const imports = order === "the-helper-first" ? [importsHelper, middleImports, builtInImport] : [middleImports, builtInImport, importsHelper]; // prettier-ignore
  const featureText = [...imports, `export const feature = helper${middleAdds}${builtInAdds};`]
    .filter(Boolean)
    .join("\n");
  const rest: [string, string][] = [
    ["legacy.cjs", legacyText],
    ["feature.mjs", featureText],
    ["helper.cjs", helperText],
    ["shared.mjs", 'export const shared = "shared";'],
  ];
  return {
    name: `${head}--${first}--${legacy}--${feature}--${middle}--${builtIn}--${order}--${helper}.mjs`,
    text: main + "\n" + rest.map(([path, held]) => `// @filename: ./${path}\n${held}\n`).join(""),
  };
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
