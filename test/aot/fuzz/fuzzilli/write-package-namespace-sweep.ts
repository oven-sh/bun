// Generates programs in which a barrel of the application re-exports a name of a package that nothing reads, while another file takes the namespace of the same package. The package has no side effects, and its entry is a star of a star of an ES module and a CommonJS file.
// Each form changes one thing. The namespace is taken by `import()`, by `import * as` or by `require`.
// Some builds stopped in 113 of these with "module 5 is not a valid module record".
//
//   bun write-package-namespace-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<form>--<use>.mjs
//   bun write-package-namespace-sweep.ts count
import { mkdirSync, writeFileSync } from "fs";

type Files = Record<string, string | undefined>;
const base: Files = {
  "main.mjs": 'import "./app.mjs";\nimport "./whole.mjs";',
  "a0.cjs": 'const q = require("./f0.mjs");\nmodule.exports = Object.keys(q).join();',
  "app.mjs": 'import done from "./a0.cjs";\nconsole.log("end", done);',
  "f0.mjs": 'import { w } from "./f1.mjs";\nexport const own = 1;',
  "f1.mjs": 'export { y as x } from "p/f2.js";\nexport const w = 235;',
  "p/f2.js": 'export * from "./f3.js";',
  "p/f3.js": 'export * from "./f5.cjs";\nexport * from "./f4.js";',
  "p/f4.js": 'export const y = String(process.env.NOT_SET ?? "y@f4");',
  "p/f5.cjs": "exports.z0 = 0;",
  "p/package.json": '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": false }',
};
const forms: [string, Files][] = [
  ["nothing-changed", {}],
  [
    "side-effects-empty-list",
    { "p/package.json": '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": [] }' },
  ],
  ["empty-commonjs-file", { "p/f5.cjs": "" }],
  [
    "commonjs-entry",
    {
      "main.mjs": 'import "./app.cjs";\nimport "./whole.mjs";',
      "a0.cjs": undefined,
      "app.mjs": undefined,
      "app.cjs": 'const q = require("./f0.mjs");\nconsole.log("end", Object.keys(q).join());',
    },
  ],
  [
    "require-in-try",
    {
      "a0.cjs":
        'let q = {};\ntry { q = require("./f0.mjs"); } catch (e) { q = { threw: e.name }; }\nmodule.exports = Object.keys(q).join();',
    },
  ],
  ["same-name", { "f1.mjs": 'export { y } from "p/f2.js";\nexport const w = 235;' }],
  [
    "uncalled-function-in-entry",
    {
      "app.mjs":
        'import done from "./a0.cjs";\nconsole.log("end", done);\nfunction $inCompany() { var fp = Function.prototype; return "zzz" in Bun; }',
    },
  ],
  [
    "read-in-uncalled-function",
    { "f0.mjs": 'import { w } from "./f1.mjs";\nfunction never() { return w; }\nexport const own = 1;' },
  ],
  ["constant-value", { "p/f4.js": 'export const y = "y@f4";' }],
  ["package-main", { "f1.mjs": 'export { y as x } from "p";\nexport const w = 235;' }],
  [
    "typescript-file",
    {
      "a0.cjs": 'const q = require("./f0.ts");\nmodule.exports = Object.keys(q).join();',
      "f0.mjs": undefined,
      "f0.ts": 'import { w } from "./f1.mjs";\nfunction never() { return w; }\nexport const own = 1;',
    },
  ],
  [
    "dynamic-import",
    {
      "a0.cjs": undefined,
      "app.mjs": 'const q = await import("./f0.mjs");\nconsole.log("end", Object.keys(q).join());',
    },
  ],
  ["name-is-read", { "f0.mjs": 'import { w } from "./f1.mjs";\nexport const own = w;' }],
  ["bare-import", { "f0.mjs": 'import "./f1.mjs";\nexport const own = 1;' }],
  ["commonjs-file-last", { "p/f3.js": 'export * from "./f4.js";\nexport * from "./f5.cjs";' }],
  ["star-of-node-path", { "p/f3.js": 'export * from "node:path";\nexport * from "./f4.js";', "p/f5.cjs": undefined }],
  ["package-reexports-by-name", { "p/f2.js": 'export { y } from "./f3.js";' }],
  [
    "third-star",
    { "p/f3.js": 'export * from "./f3b.js";', "p/f3b.js": 'export * from "./f5.cjs";\nexport * from "./f4.js";' },
  ],
  [
    "two-commonjs-files",
    {
      "p/f3.js": 'export * from "./f5.cjs";\nexport * from "./f6.cjs";\nexport * from "./f4.js";',
      "p/f6.cjs": "exports.z1 = 1;",
    },
  ],
  [
    "barrel-without-own-export",
    { "f0.mjs": 'import "./f1.mjs";\nexport const own = 1;', "f1.mjs": 'export { y as x } from "p/f2.js";' },
  ],
  ["two-names", { "f1.mjs": 'export { y as x, y as x2 } from "p/f2.js";\nexport const w = 235;' }],
  ["namespace-member", { "f0.mjs": 'import * as n1 from "./f1.mjs";\nexport const own = n1.w;' }],
  ["unused-namespace", { "f0.mjs": 'import * as n1 from "./f1.mjs";\nexport const own = 1;' }],
  ["second-reexport", { "f0.mjs": 'export { w } from "./f1.mjs";\nexport const own = 1;' }],
  [
    "file-between",
    { "f0.mjs": 'import "./f0b.mjs";\nexport const own = 1;', "f0b.mjs": 'import { w } from "./f1.mjs";' },
  ],
  [
    "namespace-import-in-entry",
    { "a0.cjs": undefined, "app.mjs": 'import * as q from "./f0.mjs";\nconsole.log("end", Object.keys(q).join());' },
  ],
  [
    "unreached-dynamic-import",
    {
      "a0.cjs": undefined,
      "app.mjs": 'if (process.env.NOT_SET_AT_ALL) await import("./f0.mjs");\nconsole.log("end", "own");',
    },
  ],
  ["unreached-require", { "a0.cjs": 'if (process.env.NOT_SET_AT_ALL) require("./f0.mjs");\nmodule.exports = "own";' }],
  [
    "required-and-imported",
    { "app.mjs": 'import done from "./a0.cjs";\nimport "./f0.mjs";\nconsole.log("end", done);' },
  ],
  [
    "create-require",
    {
      "a0.cjs":
        'const q = require("node:module").createRequire(__filename)("./f0.mjs");\nmodule.exports = Object.keys(q).join();',
    },
  ],
  [
    "side-effects-other-file",
    {
      "p/package.json":
        '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": ["./other.js"] }',
    },
  ],
  [
    "side-effects-inner-star",
    {
      "p/package.json":
        '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": ["./f3.js"] }',
    },
  ],
  [
    "side-effects-value-file",
    {
      "p/package.json":
        '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": ["./f4.js"] }',
    },
  ],
  [
    "side-effects-commonjs-file",
    {
      "p/package.json":
        '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": ["./f5.cjs"] }',
    },
  ],
  [
    "commonjs-star-in-entry-file",
    { "p/f2.js": 'export * from "./f5.cjs";\nexport * from "./f3.js";', "p/f3.js": 'export * from "./f4.js";' },
  ],
  ["unused-import", { "f1.mjs": 'import { y } from "p/f2.js";\nexport const w = 235;' }],
  ["import-then-export", { "f1.mjs": 'import { y } from "p/f2.js";\nexport { y as x };\nexport const w = 235;' }],
  ["single-star", { "p/f2.js": 'export * from "./f5.cjs";\nexport * from "./f4.js";', "p/f3.js": undefined }],
  [
    "value-in-commonjs-file",
    { "p/f3.js": 'export * from "./f5.cjs";', "p/f4.js": undefined, "p/f5.cjs": 'exports.y = "y@f5";' },
  ],
  [
    "commonjs-value-file",
    {
      "p/f3.js": 'export * from "./f5.cjs";\nexport * from "./f4.cjs";',
      "p/f4.js": undefined,
      "p/f4.cjs": 'exports.y = "y@f4";',
    },
  ],
  [
    "star-beside-name",
    { "f1.mjs": 'export { y as x } from "p/f2.js";\nexport * from "p/f2.js";\nexport const w = 235;' },
  ],
  ["star-of-package", { "f1.mjs": 'export * from "p/f2.js";\nexport const w = 235;' }],
  [
    "barrel-in-package",
    {
      "f0.mjs": 'import { w } from "p/f1.js";\nexport const own = 1;',
      "f1.mjs": undefined,
      "p/f1.js": 'export { y as x } from "./f2.js";\nexport const w = 235;',
    },
  ],
  ["namespace-reexport", { "f1.mjs": 'export * as x from "p/f2.js";\nexport const w = 235;' }],
  ["commonjs-name", { "f1.mjs": 'export { z0 as x } from "p/f2.js";\nexport const w = 235;' }],
  ["star-of-barrel", { "f0.mjs": 'export * from "./f1.mjs";\nexport const own = 1;' }],
  [
    "barrel-is-required",
    { "a0.cjs": 'const q = require("./f1.mjs");\nmodule.exports = Object.keys(q).sort().join();', "f0.mjs": undefined },
  ],
  ["reexported-name-is-read", { "f0.mjs": 'import { w, x } from "./f1.mjs";\nexport const own = x;' }],
  ["no-import", { "f0.mjs": "export const own = 1;" }],
  ["no-reexport", { "f1.mjs": "export const w = 235;" }],
  [
    "no-side-effects-field",
    { "p/package.json": '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module" }' },
  ],
  ["no-commonjs-file", { "p/f3.js": 'export * from "./f4.js";', "p/f5.cjs": undefined }],
  [
    "side-effects-entry-file",
    {
      "p/package.json":
        '{ "name": "p", "version": "1.0.0", "main": "./f2.js", "type": "module", "sideEffects": ["./f2.js"] }',
    },
  ],
];
const uses: [string, Files][] = [
  ["dynamic-import", { "whole.mjs": 'console.log("whole", Object.keys(await import("p")).sort().join());' }],
  ["namespace-import", { "whole.mjs": 'import * as p from "p";\nconsole.log("whole", Object.keys(p).sort().join());' }],
  [
    "require",
    {
      "whole-b.cjs": 'module.exports = Object.keys(require("p")).sort().join();',
      "whole.mjs": 'import keys from "./whole-b.cjs";\nconsole.log("whole", keys);',
    },
  ],
];
// Two loads by `import()` are in flight at once, and an executable settles them in the order of `bun build`.
const isOrderOfLoads = (form: string, use: string) => form === "dynamic-import" && use === "dynamic-import";
const programs = forms.flatMap(([form, changes]) =>
  uses
    .filter(([use]) => !isOrderOfLoads(form, use))
    .map(([use, files]) => ({ name: `${form}--${use}`, files: { ...base, ...changes, ...files } })),
);

function write(index: number): string {
  const { "main.mjs": main, ...others } = programs[index].files as Files;
  return [
    "// @entry: ./main.mjs",
    main,
    ...Object.entries(others).flatMap(([path, text]) =>
      text === undefined ? [] : [`// @filename: ./${path.replace(/^p\//, "node_modules/p/")}`, text],
    ),
  ].join("\n");
}

const padNumber = (index: number) => String(index).padStart(3, "0");
if (process.argv[2] === "count") console.log(programs.length);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? programs.length), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, programs.length); step++) {
    const index = (from + step * stride) % programs.length;
    writeFileSync(`${folder}/${padNumber(index)}-${programs[index].name}.mjs`, write(index) + "\n");
  }
  console.log(Math.min(count, programs.length));
}
