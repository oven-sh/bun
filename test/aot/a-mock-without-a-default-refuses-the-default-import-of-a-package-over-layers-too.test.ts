// A setup file under `[test] preload` mocks a CommonJS package with a factory that gives no `default`, and a file of the project imports the
// default. `bun test` refuses the test file where it is linked: SyntaxError: Missing 'default' export. So does a run that is compiled as one
// program. Over layers the package lies in another image than its importer, which asks the record of the file. The mock had laid its names on the
// face of the file, where the ES modules of its own image find them: the record answered for the file, which has a `default` whatever it holds,
// the link went through, the name was undefined, and each test threw a TypeError.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const importers = {
  "the default": `import validator from "validator";\nexport const check = () => validator.isEmail();\n`,
  "the default and a name": `import validator, { isEmail } from "validator";\nexport const check = () => isEmail() + typeof validator;\n`,
  // What was right before.
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
    if (name.startsWith("the default")) {
      expect(plain).toEqual({
        lines: ["SyntaxError: Missing 'default' export in module '<dir>/node_modules/validator/index.js'."],
        exitCode: 1,
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
