import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const matcher = `toBeInteger(actual) {\n  return { pass: actual === 1, message: () => "mine" };\n}`;
const uses = `test("t", () => {\n  expect(typeof expect(1).toBeInteger()).toBe(typeof expect(1).toBeOne());\n  expect(() => expect(2).toBeInteger()).toThrow("mine");\n});\n`;
const other = `toBeOne(actual) {\n  return { pass: actual === 1, message: () => "mine" };\n}`;

const forms = {
  "a literal": {
    "main.test.mjs": `import { expect, test } from "bun:test";\nexpect.extend({ ${matcher}, ${other} });\n${uses}`,
  },
  "what a function returns": {
    "main.test.mjs": `import { expect, test } from "bun:test";\nconst make = () => ({ ${matcher}, ${other} });\nexpect.extend(make());\n${uses}`,
  },
  "a name that expect itself owns": {
    "main.test.mjs": `import { expect, test } from "bun:test";\nexpect.extend({ toSatisfy(actual) {\n  return { pass: true, message: () => "mine" };\n} });\ntest("t", () => {\n  expect(typeof expect.toSatisfy).toBe("function");\n  expect(1).toSatisfy();\n});\n`,
  },
  "a namespace object": {
    "matchers.mjs": `export function ${matcher}\nexport function ${other}\n`,
    "main.test.mjs": `import { expect, test } from "bun:test";\nimport * as matchers from "./matchers.mjs";\nexpect.extend(matchers);\n${uses}`,
  },
};

for (const [name, files] of Object.entries(forms)) {
  test(`expect.extend() under the name of a built-in matcher: ${name}`, async () => {
    using dir = tempDir("aot-custom-matcher-name", files);
    const ran = await run([bunExe(), "test", "--aot", "./main.test.mjs"], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
      BUN_DEBUG_TEST_AOT_WORDS: "validate",
    });
    expect({
      output: (ran.stdout + ran.stderr).match(/AOT validation[^\n]*|\d+ (?:pass|fail)/g),
      exitCode: ran.exitCode,
    }).toEqual({
      output: ["1 pass", "0 fail"],
      exitCode: 0,
    });
  }, 240_000);
}

test.each(["TestRunLayers:2", "TestRunLayers:3"])(
  "a package that a preload imports adds matchers: %s",
  async words => {
    using dir = tempDir("aot-custom-matcher-name", {
      "package.json": `{ "name": "p" }`,
      "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
      "setup.js": `import "more-matchers";\n`,
      "node_modules/more-matchers/package.json": `{ "name": "more-matchers", "type": "module", "main": "index.js" }`,
      "node_modules/more-matchers/index.js": `import { expect } from "bun:test";\nimport * as matchers from "./matchers.js";\nexpect.extend(matchers);\n`,
      "node_modules/more-matchers/matchers.js": `export function ${matcher}\nexport function ${other}\n`,
      "a.test.js": `import { expect, test } from "bun:test";\n${uses}`,
      "b.test.js": `import { test } from "bun:test";\ntest("second", () => {});\n`,
    });
    const ran = await run([bunExe(), "test", "--aot"], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
      BUN_DEBUG_TEST_AOT_WORDS: words,
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    expect({
      startsOver: ran.stderr.split("\n").filter(line => line.startsWith("AOT build starts over")),
      exitCode: ran.exitCode,
    }).toEqual({ startsOver: [], exitCode: 0 });
  },
  240_000,
);
