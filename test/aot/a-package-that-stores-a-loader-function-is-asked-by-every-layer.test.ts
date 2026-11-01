// module-alias, tsconfig-paths and playwright store `Module._resolveFilename`, require-in-the-middle stores `Module.prototype.require`: packages all of them.
// From the store on Bun asks the function at every require(). The look through the test files reads no package, so over layers only the program that holds the package
// knew of the store: a file of the project that requires a file of the project went to the file that the build had bound, and the function was never asked.
import { expect } from "bun:test";
import { foldersOfOneRun } from "./harness/folders-of-one-run";
import { runsWholeGrids } from "./harness/ways";
import { beforeAll, describe, test } from "./supported";

const resolver = (holder: string) => `
  const seen = [];
  exports.seen = seen;
  exports.install = () => {
    const original = ${holder}._resolveFilename;
    ${holder}._resolveFilename = function (specifier, ...rest) {
      seen.push(String(specifier).replace(/^.*[\\\\/]/, ""));
      return original.call(this, specifier.endsWith("late-b.js") ? specifier.replace("late-b", "late-c") : specifier, ...rest);
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
    const Module = require("module");
    const seen = [];
    exports.seen = seen;
    exports.install = () => {
      const original = Module.prototype.require;
      Module.prototype.require = function (specifier) {
        seen.push(String(specifier).replace(/^.*[\\\\/]/, ""));
        return original.call(this, specifier.endsWith("late-b.js") ? specifier.replace("late-b", "late-c") : specifier);
      };
    };`,
};

const linesOf = foldersOfOneRun(
  "aot-package-stores-a-loader-function",
  Object.fromEntries(
    Object.entries(packages).map(([name, text]) => [
      name,
      {
        "package.json": `{ "name": "p" }`,
        "node_modules/hook/package.json": `{ "name": "hook", "main": "index.js" }`,
        "node_modules/hook/index.js": text,
        "src/late-a.js": `exports.name = "late-a";\n`,
        "src/late-b.js": `exports.name = "late-b";\n`,
        "src/late-c.js": `exports.name = "late-c";\n`,
        "src/user.js": `exports.load = () => [require("./late-a.js").name, require("./late-b.js").name].join();\n`,
        "a.test.cjs": `
      const { test } = require("bun:test");
      const { install, seen } = require("hook");
      const user = require("./src/user.js");
      test("t", () => {
        install();
        console.error("OUT in a file of the project:", user.load(), "|", seen.splice(0).join());
        console.error("OUT in the test file:", require("./src/late-b.js").name, "|", seen.splice(0).join());
      });`,
      },
    ]),
  ),
);

describe.each(Object.keys(packages))("%s", name => {
  let plain: Awaited<ReturnType<typeof linesOf>>;
  beforeAll(async () => {
    plain = await linesOf(name, []);
  });

  test("plain Bun", () => {
    expect(plain).toEqual({
      lines: [
        "OUT in a file of the project: late-a,late-c | late-a.js,late-b.js",
        "OUT in the test file: late-c | late-b.js",
      ],
      exitCode: 0,
    });
  });

  // About the layers: every package runs in every form. A build that finds the store in one package knows it of the whole program: as one program a package is alone, so
  // that each store has to be found. Over layers the fault was that the programs above were not told, and there the packages share a run.
  test.concurrent.each([
    ["as the run builds itself", undefined, true],
    ["two layers", "TestRunLayers:2", runsWholeGrids],
    ["three layers", "TestRunLayers:3", runsWholeGrids],
  ] as const)("%s", async (_, words, alone) => {
    expect(await linesOf(name, ["--aot"], words, alone)).toEqual(plain);
  });
});
