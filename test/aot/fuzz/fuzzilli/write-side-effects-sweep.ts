// A package hands names on from another file, and a program imports it twice, once by a statement and once at run time: who says that the files have no side effects, times what the index hands on, times
// how the file behind it exports, times the statement, times the reach at run time. Each program holds one of each and as good as nothing else, and is built alone.
//
//   bun write-side-effects-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<field>--<index>--<owner>--<statement>--<reach>.mjs
//   bun write-side-effects-sweep.ts count
//   bun write-side-effects-sweep.ts named <pattern> <folder> [most]
//
// A program is one file: the first file's text, and behind each line `// @filename: ./<path>` the text of another, the `package.json` of the package among them. `"sideEffects": false` lets a build drop an
// import that nothing uses, and with it what the index needed for that import alone. An `import()` of the same index still wants the whole namespace. Whoever removes the one has to leave the other whole.
import { mkdirSync, writeFileSync } from "fs";

// Where the index lies, how the program names it, how the index names the file behind it, and the files that say what has side effects. OWNER is the name of the file behind the index.
const fields: [string, string, string, string, [string, string][]][] = [
  [
    "the-package-says-it-has-none",
    "node_modules/@made-up/pkg/index.mjs",
    "@made-up/pkg",
    "./OWNER",
    [
      [
        "node_modules/@made-up/pkg/package.json",
        '{ "name": "@made-up/pkg", "version": "1.0.0", "main": "./index.mjs", "sideEffects": false }',
      ],
    ],
  ],
  [
    "the-package-says-nothing",
    "node_modules/@made-up/pkg/index.mjs",
    "@made-up/pkg",
    "./OWNER",
    [
      [
        "node_modules/@made-up/pkg/package.json",
        '{ "name": "@made-up/pkg", "version": "1.0.0", "main": "./index.mjs" }',
      ],
    ],
  ],
  [
    "the-package-lists-no-file",
    "node_modules/@made-up/pkg/index.mjs",
    "@made-up/pkg",
    "./OWNER",
    [
      [
        "node_modules/@made-up/pkg/package.json",
        '{ "name": "@made-up/pkg", "version": "1.0.0", "main": "./index.mjs", "sideEffects": [] }',
      ],
    ],
  ],
  [
    "the-application-says-it-has-none",
    "barrel.mjs",
    "./barrel.mjs",
    "@made-up/pkg",
    [
      ["package.json", '{ "name": "application", "version": "1.0.0", "sideEffects": false }'],
      ["node_modules/@made-up/pkg/package.json", '{ "name": "@made-up/pkg", "version": "1.0.0", "main": "./OWNER" }'],
    ],
  ],
];

// O is the file behind the index.
const indexes: [string, string][] = [
  ["a-star-and-a-name", 'export * from "O";\nexport { w } from "O";'],
  ["a-star", 'export * from "O";'],
  ["two-names-at-once", 'export { w, z } from "O";'],
  ["two-names-one-by-one", 'export { w } from "O";\nexport { z } from "O";'],
  ["a-star-and-the-whole-under-a-name", 'export * from "O";\nexport * as whole from "O";'],
  ["a-name-imported-and-exported", 'import { w, z } from "O";\nexport { w, z };'],
];

const owners: [string, string, string][] = [
  ["a-record-laid-on-module-exports", "owner.cjs", 'const z = "z",\n  w = "w";\nmodule.exports = { z, w };'],
  ["names-laid-on-exports", "owner.cjs", 'exports.z = "z";\nexports.w = "w";'],
  ["names-assigned-to-exports", "owner.cjs", 'Object.assign(exports, { z: "z", w: "w" });'],
  ["a-class-laid-on-exports", "owner.cjs", 'exports.z = "z";\nexports.w = class {};'],
  [
    "names-laid-on-exports-marked-as-a-module",
    "owner.cjs",
    'Object.defineProperty(exports, "__esModule", { value: true });\nexports.z = "z";\nexports.w = "w";',
  ],
  ["a-module", "owner.mjs", 'export const z = "z",\n  w = "w";'],
];

// P is how the program names the index.
const statements: [string, string][] = [
  ["an-import-of-a-name-that-nothing-uses", 'import { w } from "P";'],
  ["an-import-of-a-name-that-is-used", 'import { w } from "P";\nconsole.log(typeof w);'],
  ["no-import", ""],
  [
    "an-import-of-a-name-used-in-a-function-nothing-calls",
    'import { w } from "P";\nfunction never() {\n  return w;\n}',
  ],
  ["an-import-of-the-whole-that-nothing-uses", 'import * as all from "P";'],
  ["an-import-for-its-effects", 'import "P";'],
];

const reaches: [string, string][] = [
  ["imported-at-run-time", 'const m = await import("P");\nconsole.log(m.z);'],
  ["required", 'const m = require("P");\nconsole.log(m.z);'],
  [
    "imported-behind-a-test-that-is-never-true",
    'if (process.argv.length > 90) {\n  const m = await import("P");\n  console.log(m.z);\n}\nconsole.log("end");',
  ],
  ["imported-at-run-time-and-not-waited-for", 'import("P").then(m => console.log(m.z));'],
  ["imported-at-run-time-and-listed", 'const m = await import("P");\nconsole.log(Object.keys(m).sort().join());'],
];

const all = fields.length * indexes.length * owners.length * statements.length * reaches.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [statement, stated] = pick(statements);
  const [reach, reached] = pick(reaches);
  const [owner, ownerFile, owned] = pick(owners);
  const [index, handsOn] = pick(indexes);
  const [field, indexPath, named, behind, says] = pick(fields);
  const main = [stated, reached].filter(Boolean).join("\n").replaceAll('"P"', `"${named}"`);
  const rest: [string, string][] = [
    ...says.map(([path, text]): [string, string] => [path, text.replace("OWNER", ownerFile)]),
    [indexPath, handsOn.replaceAll('"O"', `"${behind.replace("OWNER", ownerFile)}"`)],
    [`node_modules/@made-up/pkg/${ownerFile}`, owned],
  ];
  return {
    name: `${field}--${index}--${owner}--${statement}--${reach}.mjs`,
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
