import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// As esbuild writes a package: the holder is what a helper makes of require("module").
const hook = `"use strict";
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
var import_module = __toESM(require("module"));
function installResolver() {
  const original = import_module.default._resolveFilename;
  function resolveFilename(specifier, ...rest) {
    if (specifier === "alias-of-path") specifier = "node:path";
    return original.call(this, specifier, ...rest);
  }
  import_module.default._resolveFilename = resolveFilename;
}
exports.installResolver = installResolver;
exports.load = name => require(name);
`;

const testFile = `
import { test } from "bun:test";
import { installResolver, load } from "hook";
test("a package's resolver answers", () => {
  installResolver();
  console.error("SEEN " + typeof load(["alias", "of", "path"].join("-")).join);
});
`;

test("a test run sees that a package stores a resolver, and builds the layer once", async () => {
  using dir = tempDir("aot-a-package-stores-a-resolver", {
    "package.json": `{ "name": "a-package-stores-a-resolver", "type": "module" }`,
    "node_modules/hook/package.json": `{ "name": "hook", "version": "1.0.0", "main": "lib/index.js" }`,
    "node_modules/hook/lib/index.js": hook,
    "a.test.ts": testFile,
  });
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    const lines = (stdout + "\n" + stderr).split("\n");
    return {
      seen: lines.filter(line => line.startsWith("SEEN ")),
      startsOver: lines.filter(
        line => line.startsWith("AOT build starts over") && line.includes("stores loader functions"),
      ),
      exitCode,
    };
  };
  const [plain, compiled] = await Promise.all([
    seenWith({}),
    seenWith({ BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }, "--aot", "--parallel=2"),
  ]);
  expect(plain).toEqual({ seen: ["SEEN function"], startsOver: [], exitCode: 0 });
  expect(compiled).toEqual(plain);
});
