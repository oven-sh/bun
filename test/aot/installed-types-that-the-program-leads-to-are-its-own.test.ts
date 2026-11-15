// The types of Bun are installed and the `types` of the tsconfig.json do not name them. TypeScript reads them all the same where its own program leads to them:
// from the roots of the project by an import of "bun" in any form or a `/// <reference types="bun" />`, in a file that they reach or in the declarations of a
// package. They are the project's own then, Node's behind them too, and an error that rests on them stops the build as it stops `tsc -p .`. Where nothing leads
// there `tsc` does not know `Bun`, the build names the types by itself, and what rests on them is forgiven. A build loads files that `tsc` never reads: the source
// that a package runs, an entry point that the project leaves out. And of a package that offers its source to a build, and of a referenced project, it reads the
// source where `tsc` reads the declarations. What those import says nothing of the project.
// Each row says what tsc 6.0.2 says of it. The packages are made up and laid out as the real ones are.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };

type Configuration = {
  compilerOptions?: Record<string, unknown>;
  files?: string[];
  include?: string[];
  exclude?: string[];
  references?: { path: string }[];
};
const configure = (more: Configuration = {}) =>
  JSON.stringify({
    ...more,
    compilerOptions: {
      lib: ["ESNext"],
      module: "preserve",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      ...more.compilerOptions,
    },
  });

const packages = {
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "0.0.1", "types": "index.d.ts" }`,
  "node_modules/@types/bun/index.d.ts": `/// <reference types="bun-types" />\n`,
  "node_modules/bun-types/package.json": `{ "name": "bun-types", "version": "0.0.1", "types": "index.d.ts" }`,
  "node_modules/bun-types/index.d.ts": `/// <reference types="node" />
declare module "bun" {
  export interface BunFile { readonly size: number }
  export function file(path: string): BunFile;
}
declare var Bun: typeof import("bun");
declare var console: { log(...values: unknown[]): void };
`,
  "node_modules/@types/node/package.json": `{ "name": "@types/node", "version": "0.0.1", "types": "index.d.ts" }`,
  "node_modules/@types/node/index.d.ts": `declare var process: { readonly pid: number };\n`,
};

const asksTheGlobal = `const size: string = Bun.file("main.ts").size;\nconsole.log(typeof size);\n`;
const asksTheImport = `import { file } from "bun";\nconst size: string = file("main.ts").size;\nconsole.log(typeof size);\n`;
const imports = `import { file } from "bun";\nexport const measure = file;\n`;

type Row = { files: Record<string, string>; entry?: string };

// tsc: TS2322 at `size` | `pid`, and nothing else.
const stops: Record<string, Row> = {
  "a value is imported": { files: { "main.ts": asksTheImport } },
  "a type is imported": {
    files: {
      "main.ts": `import type { BunFile } from "bun";\nfunction measure(it: BunFile): string {\n  return it.size;\n}\nconsole.log(typeof measure);\n`,
    },
  },
  "an import for its effects": { files: { "main.ts": `import "bun";\n${asksTheGlobal}` } },
  "an export from": { files: { "main.ts": `export { file } from "bun";\n${asksTheGlobal}` } },
  "an import by require": {
    files: {
      "main.cts": `import bun = require("bun");\nconst size: string = bun.file("main.ts").size;\nconsole.log(typeof size);\n`,
    },
    entry: "./main.cts",
  },
  "an import in a type": {
    files: {
      "main.ts": `declare const measure: typeof import("bun").file;\nconst size: string = measure("main.ts").size;\nconsole.log(typeof size);\n`,
    },
  },
  "a reference names the types": { files: { "main.ts": `/// <reference types="bun" />\n${asksTheGlobal}` } },
  "a reference names the package behind them": {
    files: { "main.ts": `/// <reference types="bun-types" />\n${asksTheGlobal}` },
  },
  "an import in a second file that is reached": {
    files: { "main.ts": `import "./other";\n${asksTheGlobal}`, "other.ts": imports },
  },
  "the declarations of a package refer to the types": {
    files: {
      "main.ts": `import { made } from "made-up";\nconsole.log(made);\n${asksTheGlobal}`,
      "node_modules/made-up/package.json": `{ "name": "made-up", "version": "0.0.1", "types": "index.d.ts", "main": "index.js" }`,
      "node_modules/made-up/index.d.ts": `/// <reference types="bun" />\nexport declare const made: number;\n`,
      "node_modules/made-up/index.js": `export const made = 1;\n`,
    },
  },
  "what Node.js declares, behind an import of Bun's": {
    files: { "main.ts": `import "bun";\nconst pid: string = process.pid;\nconsole.log(typeof pid);\n` },
  },
  "an import where `types` are written and empty": {
    files: { "main.ts": asksTheImport, "tsconfig.json": configure({ compilerOptions: { types: [] } }) },
  },
  "an import where `types` name another package": {
    files: { "main.ts": asksTheImport, "tsconfig.json": configure({ compilerOptions: { types: ["node"] } }) },
  },
  "JavaScript that imports, under allowJs": {
    files: {
      "main.ts": `import "./helper.js";\n${asksTheGlobal}`,
      "helper.js": `import { file } from "bun";\nconsole.log(typeof file);\n`,
      "tsconfig.json": configure({ compilerOptions: { allowJs: true } }),
    },
  },
  "the types are named: nothing is asked": {
    files: {
      "main.ts": `export {};\n${asksTheGlobal}`,
      "tsconfig.json": configure({ compilerOptions: { types: ["bun"] } }),
    },
  },
};

// tsc: TS2868 at `Bun` | TS2591 at `process`, TS2584 at `console`: it has not read the package.
const builds: Record<string, Row & { stdout: string }> = {
  "the global alone": { files: { "main.ts": `export {};\n${asksTheGlobal}` }, stdout: "number\n" },
  "what Node.js declares, alone": {
    files: { "main.ts": `export {};\nconst pid: string = process.pid;\nconsole.log(typeof pid);\n` },
    stdout: "number\n",
  },
  "JavaScript that imports, without allowJs": {
    files: {
      "main.ts": `import "./helper.js";\n${asksTheGlobal}`,
      "helper.js": `import { file } from "bun";\nconsole.log(typeof file);\n`,
    },
    stdout: "function\nnumber\n",
  },
  "an import in a file that nothing reaches and `files` leave out": {
    files: {
      "main.ts": `export {};\n${asksTheGlobal}`,
      "unreached.ts": imports,
      "tsconfig.json": configure({ files: ["main.ts"] }),
    },
    stdout: "number\n",
  },
  // tsc: silent on these two: it reads the declarations of the package and not the source that runs; it never sees the entry point.
  "a package that runs TypeScript beside its declarations imports": {
    files: {
      "main.ts": `import { made } from "made-up";\nconsole.log(made);\n${asksTheGlobal}`,
      "node_modules/made-up/package.json": `{ "name": "made-up", "version": "0.0.1", "types": "types.d.ts", "main": "code.ts" }`,
      "node_modules/made-up/types.d.ts": `export declare const made: string;\n`,
      "node_modules/made-up/code.ts": `import { file } from "bun";\nexport const made: string = typeof file;\n`,
    },
    stdout: "function\nnumber\n",
  },
  "an entry point that the project excludes imports": {
    files: {
      "main.ts": `import { file } from "bun";\nimport { measure } from "./lib";\nconsole.log(typeof file, measure());\n`,
      "lib.ts": `export function measure(): string {\n  const size: string = Bun.file("main.ts").size;\n  return typeof size;\n}\n`,
      "other.ts": `import { measure } from "./lib";\nexport const kept = measure;\n`,
      "tsconfig.json": configure({ exclude: ["main.ts", "node_modules"] }),
    },
    stdout: "function number\n",
  },
  // tsc: silent on these two: it knows no condition "aot" and takes "types"; it reads a referenced project by its output.
  "a package that offers its source under the condition aot imports": {
    files: {
      "main.ts": `import { made } from "made-up";\nconsole.log(made);\n${asksTheGlobal}`,
      "node_modules/made-up/package.json": `{ "name": "made-up", "version": "0.0.1", "exports": { ".": { "types": "./types.d.ts", "aot": "./code.ts", "default": "./code.ts" } } }`,
      "node_modules/made-up/types.d.ts": `export declare const made: string;\n`,
      "node_modules/made-up/code.ts": `import { file } from "bun";\nexport const made: string = typeof file;\n`,
    },
    stdout: "function\nnumber\n",
  },
  "a referenced project whose output is built imports": {
    files: {
      "main.ts": `import { made } from "./lib/src/index";\nconsole.log(made);\n${asksTheGlobal}`,
      "tsconfig.json": configure({ files: ["main.ts"], references: [{ path: "./lib" }] }),
      "lib/tsconfig.json": configure({
        include: ["src"],
        compilerOptions: { noEmit: false, composite: true, outDir: "dist", rootDir: "src" },
      }),
      "lib/src/index.ts": `import { file } from "bun";\nexport const made: string = typeof file;\n`,
      "lib/dist/index.d.ts": `export declare const made: string;\n`,
    },
    stdout: "function\nnumber\n",
  },
  // tsc: silent: it reads what Node.js declares and not what Bun adds to the same name.
  "what Bun adds to a function that Node.js declares, behind a reference to node": {
    files: {
      "main.ts": `/// <reference types="node" />\nfunction answer(): number {\n  return 1;\n}\nfunction ask(clock: typeof uptime): number {\n  return clock();\n}\nconsole.log(ask(answer));\nexport {};\n`,
      "node_modules/@types/node/index.d.ts": `declare var console: { log(...values: unknown[]): void };\ndeclare function uptime(): number;\n`,
      "node_modules/bun-types/index.d.ts": `/// <reference types="node" />\ndeclare function uptime(): number;\ndeclare namespace uptime {\n  function precise(): number;\n}\n`,
    },
    stdout: "1\n",
  },
};

const build = (folder: string, entry: string) =>
  spawned(
    [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, entry, "--outfile", "main"],
    folder,
    env,
  );
const codesOf = (stderr: string) =>
  stderr
    .split("\n")
    .filter(line => line.startsWith("error:"))
    .map(line => line.split(":")[1].trim());
const lay = ({ files }: Row) =>
  tempDir("aot-installed-types-that-are-led-to", { "tsconfig.json": configure(), ...packages, ...files });

describe.skipIf(!!unsupported)("the types of Bun are installed and `types` do not name them", () => {
  for (const [name, row] of Object.entries(stops)) {
    test(`stops: ${name}`, () =>
      slot(async () => {
        using dir = lay(row);
        const built = await build(String(dir), row.entry ?? "./main.ts");
        expect({ errors: codesOf(built.stderr), exitCode: built.exitCode }).toEqual({
          errors: ["TS2322"],
          exitCode: 1,
        });
      }));
  }

  for (const [name, row] of Object.entries(builds)) {
    test(`builds: ${name}`, () =>
      slot(async () => {
        using dir = lay(row);
        const folder = String(dir);
        const built = await build(folder, row.entry ?? "./main.ts");
        expect({ errors: codesOf(built.stderr), exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
        const ran = await spawned([join(folder, isWindows ? "main.exe" : "main")], folder, env);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: row.stdout, exitCode: 0 });
      }));
  }
});
