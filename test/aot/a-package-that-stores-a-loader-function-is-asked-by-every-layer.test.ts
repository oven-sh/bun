// module-alias, tsconfig-paths and playwright store `Module._resolveFilename`, require-in-the-middle stores `Module.prototype.require`: packages all of them.
// From the store on Bun asks the function at every require(). The look through the test files reads no package, so over layers only the program that holds the package
// knew of the store: a file of the project that requires a file of the project went to the file that the build had bound, and the function was never asked.
import { expect, vi } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test is one command. A debug build of Bun takes two minutes for one and holds nearly two gigabytes for it, and bun:test
// begins five tests at once there. Two at a time end within the limit of a test.
if (isDebug) vi.setConfig({ maxConcurrency: 2 });

// A package keeps each call: the name that was asked for, and the file whose module object the function was handed.
const keeps = `
  const short = value => String(value).replace(/^.*[\\\\/]/, "");
  const seen = [];
  exports.seen = seen;`;
const resolver = (holder: string) => `${keeps}
  exports.install = () => {
    const original = ${holder}._resolveFilename;
    ${holder}._resolveFilename = function (specifier, parent, ...rest) {
      seen.push(short(specifier) + " from " + short(parent.filename));
      return original.call(this, specifier.endsWith("late-b.js") ? specifier.replace("late-b", "late-c") : specifier, parent, ...rest);
    };
  };`;
const packages = {
  "a resolver": `const Module = require("module");${resolver("Module")}`,
  "a resolver, as esbuild writes the import of the module": `
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var import_module = __toESM(require("module"));${resolver("import_module.default")}`,
  "a require": `
    const Module = require("module");${keeps}
    exports.install = () => {
      const original = Module.prototype.require;
      Module.prototype.require = function (specifier) {
        seen.push(short(specifier) + " from " + short(this.filename));
        return original.call(this, specifier.endsWith("late-b.js") ? specifier.replace("late-b", "late-c") : specifier);
      };
    };`,
};

/**
 * `bun test <flags> --isolate` in a project that holds the package. With the word `TestRunLayers:<n>`, `run` fails a run that
 * was not built in `n` layers.
 */
async function ranWith(text: string, flags: string[], words: string) {
  using dir = tempDir("aot-package-stores-a-loader-function", {
    "package.json": `{ "name": "p" }`,
    "node_modules/hook/package.json": `{ "name": "hook", "main": "index.js" }`,
    "node_modules/hook/index.js": text,
    // With three layers late-a.js and late-b.js are a layer of their own, below user.js. What user.js requires then crosses
    // layers, and the loader answers it whether or not the build has found the store. What late-a.js requires stays inside its
    // layer: there only a build that knows of the store asks the function.
    "src/late-a.js": `exports.name = "late-a";\nexports.next = () => require("./late-b.js").name;\n`,
    "src/late-b.js": `exports.name = "late-b";\n`,
    "src/late-c.js": `exports.name = "late-c";\n`,
    "src/user.js": `exports.load = () => [require("./late-a.js").name, require("./late-b.js").name].join();\nexports.below = () => require("./late-a.js").next();\n`,
    "a.test.cjs": `
      const { test } = require("bun:test");
      const { install, seen } = require("hook");
      const user = require("./src/user.js");
      test("t", () => {
        install();
        console.error("OUT in a file of the project:", user.load(), "|", seen.splice(0).join());
        console.error("OUT in a file below it:", user.below(), "|", seen.splice(0).join());
        console.error("OUT in the test file:", require("./src/late-b.js").name, "|", seen.splice(0).join());
      });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "--isolate"], String(dir), env);
  // A crash prints only there.
  if (exitCode !== 0) console.error(stderr);
  return {
    printed: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)),
    results: [...stderr.matchAll(/^\((pass|fail|skip|todo)\) (.*?)(?: \[.*\])?$/gm)].map(
      match => `${match[1]} ${match[2]}`,
    ),
    ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
    stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")),
    exitCode,
  };
}

// The words are a string in every row: to a test with more parameters than its row has values, bun:test hands a callback.
const forms: [form: string, flags: string[], words: string][] = [
  ["plain", [], ""],
  ["--aot", ["--aot"], ""],
  ["--aot in two layers", ["--aot"], "TestRunLayers:2"],
  ["--aot in three layers", ["--aot"], "TestRunLayers:3"],
];

// Each package is alone in its project in every form. One store opens every program of a run to the functions, so beside a
// package whose store the build sees, a package whose store it misses passes.
test.concurrent.each(
  Object.entries(packages).flatMap(([name, text]) =>
    forms.map(([form, flags, words]): [string, string, string[], string] => [`${name}: ${form}`, text, flags, words]),
  ),
)("%s", async (_, text, flags, words) => {
  expect(await ranWith(text, flags, words)).toEqual({
    printed: [
      "OUT in a file of the project: late-a,late-c | late-a.js from user.js,late-b.js from user.js",
      "OUT in a file below it: late-c | late-a.js from user.js,late-b.js from late-a.js",
      "OUT in the test file: late-c | late-b.js from a.test.cjs",
    ],
    results: ["pass t"],
    ran: "Ran 1 test across 1 file",
    stdout: [],
    exitCode: 0,
  });
});
