// module-alias, tsconfig-paths and playwright store `Module._resolveFilename`, require-in-the-middle stores `Module.prototype.require`: packages all of them.
// From the store on Bun asks the function at every require(). The look through the test files reads no package, so over layers only the program that holds the package
// knew of the store: a file of the project that requires a file of the project went to the file that the build had bound, and the function was never asked.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// A test is one command, and waits for its turn below. A debug build takes four minutes for all of them.
raiseDefaultTimeout(isDebug ? 600_000 : 240_000);

// A package keeps each call: the name that was asked for, and the file whose module object the function was handed.
const keeps = `
  const short = value => String(value).replace(/^.*[\\\\/]/, "");
  const seen = [];
  exports.seen = seen;`;
// It sends late-b.js to a file of its own, so an answer says whose function was asked.
const sent = (name: string) =>
  `specifier.endsWith("late-b.js") ? specifier.replace("late-b", "late-by-${name}") : specifier`;
const resolver = (holder: string, name: string) => `${keeps}
  exports.install = () => {
    const original = ${holder}._resolveFilename;
    ${holder}._resolveFilename = function (specifier, parent, ...rest) {
      seen.push(short(specifier) + " from " + short(parent.filename));
      return original.call(this, ${sent(name)}, parent, ...rest);
    };
  };`;
const packages: Record<string, (name: string) => string> = {
  "resolver": name => `const Module = require("module");${resolver("Module", name)}`,
  // As esbuild writes the import of the module.
  "resolver-of-esbuild": name => `
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
    var import_module = __toESM(require("module"));${resolver("import_module.default", name)}`,
  "require": name => `
    const Module = require("module");${keeps}
    exports.install = () => {
      const original = Module.prototype.require;
      Module.prototype.require = function (specifier) {
        seen.push(short(specifier) + " from " + short(this.filename));
        return original.call(this, ${sent(name)});
      };
    };`,
};
const all = Object.keys(packages);

const testFileOf = (name: string) => `
  const { test } = require("bun:test");
  const { install, seen } = require("hook-${name}");
  const user = require("./src/user.js");
  test("${name}", () => {
    install();
    console.error("OUT ${name} in a file of the project:", user.load(), "|", seen.splice(0).join());
    console.error("OUT ${name} in the test file:", require("./src/late-b.js").name, "|", seen.splice(0).join());
  });`;

/** What the test file of a package prints under plain `bun test`. */
const printedBy = (name: string) => [
  `OUT ${name} in a file of the project: late-a,late-by-${name} | late-a.js from user.js,late-b.js from user.js`,
  `OUT ${name} in the test file: late-by-${name} | late-b.js from ${name}.test.cjs`,
];

/** A project with a test file for each of the packages. The test files share the files under src. */
const projectOf = (names: string[]) => ({
  "package.json": `{ "name": "p" }`,
  "src/late-a.js": `exports.name = "late-a";\n`,
  "src/late-b.js": `exports.name = "late-b";\n`,
  "src/user.js": `exports.load = () => [require("./late-a.js").name, require("./late-b.js").name].join();\n`,
  ...Object.fromEntries(
    names.flatMap(name => [
      [`node_modules/hook-${name}/package.json`, `{ "name": "hook-${name}", "main": "index.js" }`],
      [`node_modules/hook-${name}/index.js`, packages[name](name)],
      [`src/late-by-${name}.js`, `exports.name = "late-by-${name}";\n`],
      [`${name}.test.cjs`, testFileOf(name)],
    ]),
  ),
});

// A build keeps several processors busy, and a debug build of Bun holds nearly two gigabytes for one. So three commands run at
// a time.
let free = 3;
const waiting: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

/**
 * `bun test <flags> --isolate` in a project of its own. With the word `TestRunLayers:<n>`, `run` fails a run that was not built
 * in `n` layers.
 */
async function ranIn(names: string[], flags: string[], words: string) {
  using dir = tempDir("aot-package-stores-a-loader-function", projectOf(names));
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await inTurn(() =>
    run([bunExe(), "test", ...flags, "--isolate"], String(dir), env),
  );
  // A crash prints only there.
  if (exitCode !== 0) console.error(stderr);
  return {
    // Sorted: the order of the test files is not what is asked.
    printed: stderr
      .split("\n")
      .filter(line => /^(OUT|error)/.test(line))
      .sort(),
    results: [...stderr.matchAll(/^\((pass|fail|skip|todo)\) (.*?)(?: \[.*\])?$/gm)]
      .map(match => `${match[1]} ${match[2]}`)
      .sort(),
    ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
    stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")),
    exitCode,
  };
}

// Every row has its words, empty or not: to a test with more parameters than its row has values, bun:test hands a callback.
type Run = [title: string, names: string[], flags: string[], words: string];

// One store opens every program of a run to the functions, so beside a package whose store the build sees, a package whose
// store it misses passes. So each package is alone in its project for plain `bun test`, for one program and for two layers,
// which is how a run in layers is built unless a word says otherwise. The lowest layer holds the packages with Bun's own code
// and takes nearly all the time of such a run, and it is the same program whether two layers are built or three. So the run in
// three layers is one for all three packages: each function is asked over one more layer, and Bun's own code is built once.
const runs: Run[] = [
  ...all.flatMap((name): Run[] => [
    [`${name} alone: plain`, [name], [], ""],
    [`${name} alone: --aot`, [name], ["--aot"], ""],
    [`${name} alone: --aot in two layers`, [name], ["--aot"], "TestRunLayers:2"],
  ]),
  ["all three: plain", all, [], ""],
  ["all three: --aot in three layers", all, ["--aot"], "TestRunLayers:3"],
];

test.concurrent.each(runs)("%s", async (_, names, flags, words) => {
  expect(await ranIn(names, flags, words)).toEqual({
    printed: names.flatMap(printedBy).sort(),
    results: names.map(name => `pass ${name}`).sort(),
    ran: names.length === 1 ? "Ran 1 test across 1 file" : `Ran ${names.length} tests across ${names.length} files`,
    stdout: [],
    exitCode: 0,
  });
});
