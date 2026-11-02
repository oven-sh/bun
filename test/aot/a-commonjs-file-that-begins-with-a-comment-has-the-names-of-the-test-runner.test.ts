// `bun test` hands every file `test`, `expect`, `jest` and the like. In a compiled run a CommonJS file that begins with a comment like
// `/** @license MIT */` did not get them: a test file stopped with "Cannot access '%test:test' before initialization", and in a file that a
// test requires `typeof jest` was "undefined". react-dom 18 asks exactly that to find out whether act() applies.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

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

const says = `("the names are there", () => {
  expect(1).toBe(1);
  console.log("SEEN", typeof jest, typeof jest.fn, typeof describe);
});`;

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/asks/package.json": `{ "name": "asks", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/asks/index.js": `/**\n * @license MIT\n */\n"use strict";\n${asksInFunction}`,
  "one-line.test.cjs": `/** @license MIT */\nconst path = require("node:path");\ntest${says}`,
  "docblock.test.cjs": `/**\n * Copyright.\n *\n * @jest-environment node\n */\n"use strict";\nconst path = require("node:path");\ntest${says}`,
  "two-comments.test.cjs": `/** @license MIT */\n/** @type {number} */\nconst one = 1;\nmodule.exports = one;\ntest${says}`,
  "behind-a-line.test.cjs": `\n/** @license MIT */\nconst path = require("node:path");\ntest${says}`,
  "module.test.mjs": `/** @license MIT */\ntest${says}\nexport {};`,
  "package.test.cjs": `const asks = require("asks");\ntest("a package asks", () => {\n  console.log("SEEN", asks.atLoad, asks.kindOfJest());\n});`,
};

const forms = { "one program": "TestRunLayers:0", "two layers": "TestRunLayers:2,TestRunPartFiles:1" };

for (const [title, words] of Object.entries(forms)) {
  for (const file of Object.keys(files).filter(name => name.includes(".test."))) {
    test(`${file}: ${title}`, async () => {
      using dir = tempDir("a-commonjs-file-that-begins-with-a-comment", files);
      const seen = async (...flags: string[]) => {
        const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, `./${file}`], String(dir), env);
        expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
        return stdout.split("\n").filter(line => line.startsWith("SEEN"));
      };
      const plain = await seen();
      expect(plain).toEqual([file === "package.test.cjs" ? "SEEN object object" : "SEEN object function function"]);
      expect(await seen("--aot")).toEqual(plain);
    });
  }
}
