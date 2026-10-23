import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { slot } from "./run-programs";
import { test } from "./supported";

const probe = `console.log((function () { return typeof this; })(), (() => { try { Object.freeze({ a: 1 }).a = 2; return "stored in silence"; } catch (error) { return error.constructor.name; } })());\n`;

const importsOfTypesAreDropped = `{ "compilerOptions": { "target": "ESNext", "module": "Preserve", "moduleResolution": "bundler", "strict": true, "noEmit": true, "verbatimModuleSyntax": false } }`;

const folders: Record<string, Record<string, string>> = {
  "an-mjs-file-that-calls-require": { "main.mjs": `const path = require("node:path");\n${probe}` },
  "a-js-file-of-a-module-package-that-calls-require": {
    "package.json": `{ "type": "module" }`,
    "main.js": `const path = require("node:path");\n${probe}`,
  },
  "a-js-file-with-require-and-a-top-level-await": {
    "main.js": `const path = require("node:path");\nawait null;\n${probe}`,
  },
  "a-cjs-file-that-names-import-meta": { "main.cjs": `const here = import.meta.url;\n${probe}` },
  "a-cjs-file-with-a-top-level-await": { "main.cjs": `await null;\n${probe}` },
  "a-js-file-that-calls-require": { "main.js": `const path = require("node:path");\n${probe}` },
  "a-cjs-file-without-a-sign": { "main.cjs": probe },
  "a-js-file-without-a-sign": { "main.js": probe },
  "a-js-file-that-asks-for-the-type-of-require": { "main.js": `const kind = typeof require;\n${probe}` },
  "a-library-of-a-module-package-that-calls-require": {
    "package.json": `{ "type": "module" }`,
    "main.js": `import "./lib.js";\n`,
    "lib.js": `const path = require("node:path");\n${probe}`,
  },
  "a-js-file-that-names-its-folder": { "main.js": `const here = __dirname;\ncounter = 1;\n${probe}` },
  "a-js-file-that-names-itself": { "main.js": `const here = __filename;\n${probe}` },
  "a-library-whose-only-sign-is-its-folder": {
    "main.js": `import lib from "./lib.js";\nconsole.log(JSON.stringify(lib));\n`,
    "lib.js": `const here = __dirname;\n${probe}`,
  },
  "a-js-file-that-reads-require-main": { "main.js": `const main = require.main;\n${probe}` },
  "a-js-file-that-says-use-strict": { "main.js": `"use strict";\n${probe}` },
  "a-file-that-is-nothing-but-a-built-in-module-handed-on": {
    "main.cjs": `const found = require("./lib/stream.js");\nconsole.log(typeof found, typeof found.Readable);\n`,
    "lib/stream.js": `module.exports = require('stream');\n`,
  },
  "a-file-that-hands-on-a-built-in-module-named-with-node": {
    "main.cjs": `const found = require("./lib/stream.js");\nconsole.log(typeof found, typeof found.Readable);\n`,
    "lib/stream.js": `module.exports = require('node:stream');\n`,
  },
  "a-file-that-hands-on-a-built-in-module-that-every-program-holds": {
    "main.cjs": `const found = require("./lib/path.js");\nconsole.log(typeof found, found.join("a", "b"));\n`,
    "lib/path.js": `module.exports = require('path');\n`,
  },
  "a-file-that-hands-on-a-built-in-module-that-nothing-else-names": {
    "main.cjs": `const found = require("./lib/zlib.js");\nconsole.log(typeof found, typeof found.gzipSync);\n`,
    "lib/zlib.js": `module.exports = require('zlib');\n`,
  },
  "a-file-that-hands-on-a-member-of-a-built-in-module": {
    "main.cjs": `const found = require("./lib/readable.js");\nconsole.log(typeof found, found.name);\n`,
    "lib/readable.js": `module.exports = require('stream').Readable;\n`,
  },
  "a-file-that-stores-a-built-in-module-to-exports-too": {
    "main.cjs": `const found = require("./lib/events.js");\nconsole.log(typeof found, typeof found.once);\n`,
    "lib/events.js": `exports = module.exports = require('events');\n`,
  },
  "a-file-that-hands-on-a-built-in-module-and-is-imported": {
    "main.mjs": `import found from "./lib/stream.js";\nconsole.log(typeof found, typeof found.Readable);\n`,
    "lib/stream.js": `module.exports = require('stream');\n`,
  },
  "a-typescript-file-that-imports-a-type-and-stores-to-module-exports-is-required": {
    "tsconfig.json": importsOfTypesAreDropped,
    "main.cjs": `const config = require("./config");\nconsole.log(JSON.stringify(config));\n`,
    "config.ts": `import { Config } from "./types";\nconst config: Config = { name: "app", port: 80 };\nmodule.exports = config;\n`,
    "types.ts": `export type Config = { name: string; port: number };\n`,
  },
  "a-typescript-file-that-imports-a-type-and-stores-to-module-exports-is-imported": {
    "main.ts": `// @ts-expect-error TypeScript sees no export in a file that stores to module.exports\nimport config from "./config";\nconsole.log(JSON.stringify(config));\n`,
    "config.ts": `import type { Config } from "./types";\nconst config: Config = { name: "app", port: 80 };\nmodule.exports = config;\n`,
    "types.ts": `export type Config = { name: string; port: number };\n`,
  },
  "a-typescript-file-that-imports-a-type-and-stores-to-module-exports-is-the-main-file": {
    "tsconfig.json": importsOfTypesAreDropped,
    "main.ts": `import { Config } from "./types";\nconst config: Config = { name: "app", port: 80 };\nmodule.exports = config;\nconsole.log(typeof module, JSON.stringify(module.exports));\n`,
    "types.ts": `export type Config = { name: string; port: number };\n`,
  },
  "an-enum-behind-export-equals-in-a-cts-file": {
    "main.ts": `import E = require("./lib.cts");\nconsole.log(E.A, E[2]);\n`,
    "lib.cts": `enum E { A = 1, B }\nexport = E;\n`,
  },
  "a-class-behind-export-equals": {
    "main.ts": `import Shape = require("./lib");\nconsole.log(new Shape(3).sides);\n`,
    "lib.ts": `class Shape { constructor(public sides: number) {} }\nexport = Shape;\n`,
  },
  "a-function-behind-export-equals-imported-by-default": {
    "main.ts": `import double from "./lib.cts";\nconsole.log(double(21));\n`,
    "lib.cts": `function double(x: number) { return x * 2; }\nexport = double;\n`,
  },
  "an-object-behind-export-equals-that-is-required": {
    "main.cjs": `const lib = require("./lib.ts");\nconsole.log(JSON.stringify(lib));\n`,
    "lib.ts": `const lib = { name: "lib", port: 80 };\nexport = lib;\n`,
  },
  "export-equals-beside-an-import-for-a-type": {
    "main.ts": `import config = require("./config");\nconsole.log(JSON.stringify(config));\n`,
    "config.ts": `import type { Config } from "./types";\nconst config: Config = { name: "app", port: 80 };\nexport = config;\n`,
    "types.ts": `export type Config = { name: string; port: number };\n`,
  },
  "a-cjs-file-that-reads-module-filename-beside-import-meta": {
    "main.cjs": `console.log(typeof module.filename, typeof import.meta.url);\n${probe}`,
  },
  "a-js-file-that-reads-module-id-beside-import-meta": {
    "main.js": `console.log(typeof module.id, typeof import.meta.url);\n${probe}`,
  },
  "a-js-file-that-reads-module-path": { "main.js": `console.log(typeof module.path);\n${probe}` },
  "a-cjs-file-without-a-sign-that-is-imported": { "main.mjs": `import "./imported.cjs";\n`, "imported.cjs": probe },
  "a-cjs-file-without-a-sign-that-is-imported-dynamically": {
    "main.mjs": `await import("./imported.cjs");\n`,
    "imported.cjs": probe,
  },
  "a-cjs-file-without-a-sign-that-is-required": { "main.cjs": `require("./required.cjs");\n`, "required.cjs": probe },
  "a-js-file-without-a-sign-of-a-commonjs-package-that-is-imported": {
    "main.mjs": `import "./package/entry.js";\n`,
    "package/package.json": `{ "type": "commonjs" }`,
    "package/entry.js": probe,
  },
};

const wire = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

const mainOf = (files: Record<string, string>) => Object.keys(files).find(name => name.startsWith("main."))!;

// bun run takes such a file for an ES module, which is strict. With --aot it is CommonJS, and sloppy.
const differToday = [
  "a-cjs-file-without-a-sign-that-is-imported",
  "a-cjs-file-without-a-sign-that-is-imported-dynamically",
];

const eachFolder = (
  isChosen: (name: string) => boolean,
  work: (name: string, files: Record<string, string>) => Promise<void>,
) =>
  Promise.all(
    Object.entries(folders)
      .filter(([name]) => isChosen(name))
      .map(([name, files]) => slot(() => work(name, files))),
  );

async function differingUnderRun(isChosen: (name: string) => boolean) {
  const differing: unknown[] = [];
  await eachFolder(isChosen, async (name, files) => {
    using dir = tempDir("file-kinds", files);
    const plain = await run([bunExe(), "run", mainOf(files)], String(dir), bunEnv);
    const aot = await run([bunExe(), "run", "--debug-aot", mainOf(files)], String(dir), wire);
    if (aot.stdout !== plain.stdout || aot.exitCode !== plain.exitCode)
      differing.push({ name, plain: plain.stdout, aot: aot.stdout, exitCode: aot.exitCode });
  });
  return differing;
}

async function differingInExecutables(isChosen: (name: string) => boolean) {
  const differing: unknown[] = [];
  await eachFolder(isChosen, async (name, files) => {
    using dir = tempDir("file-kinds", files);
    const plain = await run([bunExe(), "run", mainOf(files)], String(dir), bunEnv);
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", mainOf(files), "--outfile", "program"],
      String(dir),
      bunEnv,
    );
    if (build.exitCode !== 0) {
      differing.push({ name, build: build.stderr });
      return;
    }
    const aot = await run([join(String(dir), "program")], String(dir), wire);
    if (aot.stdout !== plain.stdout || aot.exitCode !== plain.exitCode)
      differing.push({ name, plain: plain.stdout, aot: aot.stdout, exitCode: aot.exitCode });
  });
  return differing;
}

test("bun run --aot takes a file for what bun run takes it for", async () => {
  expect(await differingUnderRun(name => !differToday.includes(name))).toEqual([]);
}, 240_000);

test("an executable made with --aot takes a file for what bun run takes it for", async () => {
  expect(await differingInExecutables(name => !differToday.includes(name))).toEqual([]);
}, 280_000);

test.todo(
  "bun run --aot takes an imported .cjs file without a sign of CommonJS for what bun run takes it for",
  async () => {
    expect(await differingUnderRun(name => differToday.includes(name))).toEqual([]);
  },
  240_000,
);

test.todo(
  "an executable made with --aot takes an imported .cjs file without a sign of CommonJS for what bun run takes it for",
  async () => {
    expect(await differingInExecutables(name => differToday.includes(name))).toEqual([]);
  },
  280_000,
);
