// `bun test` hands every file `test`, `expect`, `jest` and the like. In a compiled run a CommonJS file that begins with a comment like
// `/** @license MIT */` did not get them: a test file stopped with "Cannot access '%test:test' before initialization", and in a file that a
// test requires `typeof jest` was "undefined". react-dom 18 asks exactly that to find out whether act() applies.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(120_000);

const asksInFunction = `
if (process.env.NODE_ENV !== "production") {
  (function () {
    function kindOfJest() {
      {
        var kind = typeof jest;
        return kind;
      }
    }
    exports.kindOfJest = kindOfJest;
    exports.atLoad = kindOfJest();
    if ("function") {
    }
  })();
}`;

const says = (file: string) => `("the names are there", () => {
  expect(1).toBe(1);
  console.log("SEEN ${file}", typeof jest, typeof jest.fn, typeof describe);
});`;

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/asks/package.json": `{ "name": "asks", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/asks/index.js": `/**\n * @license MIT\n */\n"use strict";\n${asksInFunction}`,
  "one-line.test.cjs": `/** @license MIT */\nconst path = require("node:path");\ntest${says("one-line")}`,
  "docblock.test.cjs": `/**\n * Copyright.\n *\n * @jest-environment node\n */\n"use strict";\nconst path = require("node:path");\ntest${says("docblock")}`,
  "two-comments.test.cjs": `/** @license MIT */\n/** @type {number} */\nconst one = 1;\nmodule.exports = one;\ntest${says("two-comments")}`,
  "behind-a-line.test.cjs": `\n/** @license MIT */\nconst path = require("node:path");\ntest${says("behind-a-line")}`,
  "module.test.mjs": `/** @license MIT */\ntest${says("module")}\nexport {};`,
  "package.test.cjs": `const asks = require("asks");\ntest("a package asks", () => {\n  console.log("SEEN package", asks.atLoad, asks.kindOfJest());\n});`,
};
const testFiles = Object.keys(files)
  .filter(name => name.includes(".test."))
  .map(name => `./${name}`);

const forms = { "one program": "TestRunLayers:0", "two layers": "TestRunLayers:2,TestRunPartFiles:1" };

// The test files don't see one another, so one run holds them all. Over layers each is a part of its own.
for (const [title, words] of Object.entries(forms)) {
  test(title, async () => {
    using dir = tempDir("a-commonjs-file-that-begins-with-a-comment", files);
    const seen = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...testFiles], String(dir), env);
      const lines = stdout
        .split("\n")
        .filter(line => line.startsWith("SEEN"))
        .sort();
      return { lines, stderr: exitCode ? stderr : "", exitCode };
    };
    const plain = await seen();
    expect(plain).toEqual({
      lines: [
        "SEEN behind-a-line object function function",
        "SEEN docblock object function function",
        "SEEN module object function function",
        "SEEN one-line object function function",
        "SEEN package object object",
        "SEEN two-comments object function function",
      ],
      stderr: "",
      exitCode: 0,
    });
    expect(await seen("--aot")).toEqual(plain);
  });
}
