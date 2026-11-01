// A setup file under `[test] preload` mocks a CommonJS package with a factory that gives no `default`, and a file of the project imports the
// default. In `bun test` the mock stands in place of the package and answers for every name: the import links and the default is undefined. So a
// call on it throws a TypeError in each test, and `typeof` says "undefined".
// A compiled run refused the link instead (SyntaxError: Missing 'default' export), as `bun test` did before it followed Vitest on module mocks. Over
// layers the package lies in another image than its importer, which asks the record of the file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const importers = {
  "the default": `import validator from "validator";\nexport const check = () => validator.isEmail();\n`,
  "the default and a name": `import validator, { isEmail } from "validator";\nexport const check = () => isEmail() + typeof validator;\n`,
  // What was the same before.
  "a name": `import { isEmail } from "validator";\nexport const check = () => isEmail();\n`,
  "the namespace": `import * as validator from "validator";\nexport const check = () => validator.isEmail() + String(validator.default);\n`,
  "require": `const validator = require("validator");\nexport const check = () => validator.isEmail();\n`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const lines = stderr.replaceAll(dir, "<dir>").split("\n");
  return { lines: [...new Set(lines.filter(line => /^OUT|Error: /.test(line)))].sort(), exitCode };
}

test.concurrent.each(Object.entries(importers))(
  "%s",
  async (name, importer) => {
    using folder = tempDir("aot-mock-without-a-default-over-layers", {
      "package.json": `{ "name": "p" }`,
      "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n`,
      "node_modules/validator/package.json": `{ "name": "validator", "main": "index.js" }`,
      "node_modules/validator/index.js": `exports.isEmail = () => "real";\n`,
      "setup.ts": `import { mock } from "bun:test";\nmock.module("validator", () => ({ isEmail: () => "mocked in the setup file" }));\n`,
      "src/check.ts": importer,
      "a.test.ts": `import { test } from "bun:test";\nimport { check } from "./src/check";\ntest("a", () => { console.error("OUT a", check()); });\n`,
      "b.test.ts": `import { test } from "bun:test";\nimport { check } from "./src/check";\ntest("b", () => { console.error("OUT b", check()); });\n`,
    });
    const dir = String(folder);
    const plain = await run(dir, ["--isolate"]);
    if (name === "the default") {
      expect(plain).toEqual({
        lines: ["TypeError: undefined is not an object (evaluating 'validator.isEmail')"],
        exitCode: 1,
      });
    } else if (name === "the default and a name") {
      expect(plain).toEqual({
        lines: ["OUT a mocked in the setup fileundefined", "OUT b mocked in the setup fileundefined"],
        exitCode: 0,
      });
    } else {
      expect(plain.exitCode).toBe(0);
    }
    expect(await run(dir, ["--aot", "--isolate"], "TestRunLayers:0")).toEqual(plain);
    expect(await run(dir, ["--aot", "--isolate"], "TestRunLayers:2")).toEqual(plain);
    expect(await run(dir, ["--aot", "--isolate"], "TestRunLayers:3")).toEqual(plain);
    expect(await run(dir, ["--aot", "--parallel=2", "--aot-memory-limit=1KB"])).toEqual(plain);
  },
  240_000,
);
