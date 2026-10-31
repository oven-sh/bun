import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const passes = (name: string) =>
  `import { expect, test } from "bun:test";\ntest("${name}", () => {\n  expect(1).toBe(1);\n});\n`;

const files = {
  "package.json": `{ "name": "p" }`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
  "node_modules/helpers/package.json": `{ "name": "helpers", "main": "index.js", "types": "index.d.ts" }`,
  "node_modules/helpers/index.d.ts": `export declare function mockModule(path: string, factory: () => unknown): void;\n`,
  "node_modules/helpers/index.js": `const { mock } = require("bun:test");
exports.mockModule = (path, factory) => mock.module(path, factory);
`,
  "node_modules/legacy/package.json": `{ "name": "legacy", "main": "index.js" }`,
  "node_modules/legacy/index.js": `for (const key of ["render"]) exports[key] = () => "rendered";\n`,
  "node_modules/modern/package.json": `{ "name": "modern", "type": "module", "main": "index.js", "types": "index.d.ts" }`,
  "node_modules/modern/index.d.ts": `export declare function render(): string;\n`,
  "node_modules/modern/index.js": `import { render } from "legacy";\nexport { render };\n`,
  "first.test.ts": `import { expect, test } from "bun:test";
import { mockModule } from "helpers";
test("first", () => {
  expect(typeof mockModule).toBe("function");
});
`,
  "second.test.ts": passes("second"),
  "third.test.ts": passes("third"),
  "fourth.test.ts": passes("fourth"),
  "other/package.json": `{ "type": "module" }`,
  "other/tsconfig.json": `{ "compilerOptions": { "strict": true, "exactOptionalPropertyTypes": true } }`,
  "other/lacks-a-package.test.ts": `import { expect, test } from "bun:test";
import { render } from "modern";
import { nothing } from "not-installed";
test("lacks a package", () => {
  expect(render() + typeof nothing).toBe("renderedundefined");
});
`,
  "other/has-all.test.ts": `import { expect, test } from "bun:test";
import { render } from "modern";
test("has all", () => {
  expect(render()).toBe("rendered");
});
`,
};

test.each(["TestRunLayers:0", "TestRunLayers:2"])("the run ends as under plain bun test (%s)", async words => {
  using dir = tempDir("aot-another-tsconfig-beside-a-package-that-mocks", files);
  const told = async (...flags: string[]) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], String(dir), env);
    return {
      results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)]
        .map(match => `${match[1]} ${match[2]}`)
        .sort(),
      errors: stderr
        .split("\n")
        .filter(line => line.startsWith("error: "))
        .map(line => line.replace(/ from .*/, "")),
      exitCode,
    };
  };
  const plain = await told();
  expect(plain.errors).toEqual(["error: Cannot find package 'not-installed'"]);
  expect(plain.results.length).toBe(5);
  expect(await told("--aot")).toEqual(plain);
});
