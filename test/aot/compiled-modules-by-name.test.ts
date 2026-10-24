// A module that is compiled into an executable is found by a constant name, also where `require` is held in a variable that the
// compiler follows. The name is resolved as `bun run` resolves it: as spelled, with an extension added, with a TypeScript extension in
// place of the written one, as a directory with an index file, and through `..`, also above the folder of the entry point.
// A name that is put together at run time, or that is given to a loader the compiler does not follow, finds no file that is in the
// executable only because another file imports it: the call throws and says to pass the file as another entry point.
// The sources are moved away before the executable runs, so nothing is found on disk, and BUN_JSC_crashIfInterpreterIsUsed=1 crashes
// the executable if any of its code is interpreted.
import { expect } from "bun:test";
import { renameSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const files = {
  "src/app/lib.cjs": `exports.name = "lib";\n`,
  "src/app/typed.ts": `export const name: string = "typed";\n`,
  "src/app/esm.mjs": `export const name = "esm";\n`,
  "src/app/nested/index.cjs": `exports.name = "nested";\n`,
  "src/app/nested/inner.cjs": `exports.name = "inner"; exports.load = require;\n`,
  "src/shared/util.cjs": `exports.name = "util"; exports.load = require;\n`,
  "src/app/never-named.cjs": `exports.name = "never named";\n`,
  "away/empty": "",
};

// Each constant name puts its file into the executable.
const named = `require("./lib.cjs"); require("./typed.ts"); require("./nested/index.cjs"); require("./nested/inner.cjs"); require("../shared/util.cjs");`;

const refusal =
  "this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point.";
const answerOf = `const answerOf = async load => {
  try {
    return (await load()).name;
  } catch (error) {
    return error.message.replace(/^Cannot load '.*': /, "").replace(/ \\(bun compile differs .*$/, "");
  }
};`;

const programs: Record<string, { source: string; prints: unknown }> = {
  "as-spelled.cjs": {
    source: `${named}
const load = require;
console.log(JSON.stringify([load("./lib.cjs").name, load("./nested/inner.cjs").name, load("./nested/../lib.cjs").name, load("./lib.cjs/").name]));`,
    prints: ["lib", "inner", "lib", "lib"],
  },
  "from-the-path-of-the-source.cjs": {
    source: `${named}
const load = require;
const path = require("node:path");
${answerOf}
Promise.all([() => load(__dirname + "/lib.cjs"), () => load(path.join(__dirname, "nested"))].map(answerOf)).then(answers => console.log(JSON.stringify(answers)));`,
    prints: ["lib", "nested"],
  },
  "one-module-object.cjs": {
    source: `${named}
const load = require;
console.log(JSON.stringify([load("./lib.cjs") === require("./lib.cjs"), load("./lib") === require("./lib.cjs"), load.resolve("./lib") === require.resolve("./lib.cjs")]));`,
    prints: [true, true, true],
  },
  "extension-added.cjs": {
    source: `${named}
const load = require;
console.log(JSON.stringify([load("./lib").name, load("./typed").name, load("./nested/inner").name]));`,
    prints: ["lib", "typed", "inner"],
  },
  "typescript-for-javascript.cjs": {
    source: `${named}
const load = require;
console.log(JSON.stringify([load("./typed.js").name]));`,
    prints: ["typed"],
  },
  "index-file.cjs": {
    source: `${named}
const load = require;
console.log(JSON.stringify([load("./nested").name, load("./nested/").name]));`,
    prints: ["nested", "nested"],
  },
  "above-the-entry-point.cjs": {
    source: `${named}
const load = require;
const util = load("../shared/util.cjs");
console.log(JSON.stringify([util.name, load("../shared/util").name]));`,
    prints: ["util", "util"],
  },
  "require-that-a-module-exports.cjs": {
    source: `${named}
const load = require;
${answerOf}
Promise.all([() => load("./nested/inner.cjs").load("."), () => load("./nested/inner.cjs").load("../../shared/util.cjs"), () => load("../shared/util.cjs").load("./util.cjs")].map(answerOf)).then(answers => console.log(JSON.stringify(answers)));`,
    prints: [refusal, refusal, refusal],
  },
  "create-require.mjs": {
    source: `import { createRequire } from "node:module";
import "./lib.cjs";
import "./nested/index.cjs";
const make = createRequire;
const load = make(import.meta.url);
${answerOf}
console.log(JSON.stringify(await Promise.all([() => load("./lib.cjs"), () => load("./lib"), () => load("./nested")].map(answerOf))));`,
    prints: [refusal, refusal, refusal],
  },
  "computed-import.mjs": {
    source: `import "./esm.mjs";
import "./lib.cjs";
const names = [["./esm", ".mjs"], ["./lib", ".cjs"]].map(parts => parts.join(""));
${answerOf}
console.log(JSON.stringify(await Promise.all(names.map(name => answerOf(() => import(name))))));`,
    prints: [refusal, refusal],
  },
  "not-in-the-executable.cjs": {
    source: `${named}
const load = require;
const codes = ["./absent.cjs", "./never-named.cjs", "./never-named", __dirname + "/never-named.cjs", "./lib.mjs"].map(name => {
  try {
    return load(name).name;
  } catch (error) {
    return error.code;
  }
});
console.log(JSON.stringify(codes));`,
    prints: ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND"],
  },
};

describe.concurrent("compile/aot/compiled modules by name", () => {
  for (const [name, { source, prints }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-compiled-modules-by-name", { ...files, [`src/app/${name}`]: source + "\n" });
          const folder = String(dir);
          const executable = join(folder, "away", "program" + (isWindows ? ".exe" : ""));
          const build = await spawned(
            [bunExe(), "build", "--compile", "--aot", name, "--outfile", executable],
            join(folder, "src", "app"),
            bunEnv,
          );
          expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
            stderr: expect.any(String),
            exitCode: 0,
          });
          renameSync(join(folder, "src"), join(folder, "moved"));
          const run = await spawned([executable], join(folder, "away"), {
            ...bunEnv,
            BUN_JSC_crashIfInterpreterIsUsed: "1",
          });
          expect({ stdout: run.stdout.trim(), stderr: run.stderr, exitCode: run.exitCode, signal: run.signal }).toEqual(
            {
              stdout: JSON.stringify(prints),
              stderr: expect.any(String),
              exitCode: 0,
              signal: null,
            },
          );
        }),
      600_000,
    );
  }
});
