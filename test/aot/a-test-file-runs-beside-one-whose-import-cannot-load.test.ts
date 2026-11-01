// BUN_AOT_TEST_FILES_FROM_DISK=1 BUN_AOT_TESTS_NAME_WHAT_THEY_USE=1: the build does not see the test files, and one generated file imports what they import.
// A test file whose import cannot load fails alone, as under `bun test`. The test file beside it still reaches what it imports.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const fromDisk = { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };

const healthy = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  "src/good.js": `export const good = () => "good";\nexport const unused = () => "unused";\n`,
  "tests/healthy.test.js": `import { expect, test } from "bun:test";
import { good } from "../src/good.js";
test("a healthy file", () => {
  expect(good()).toBe("good");
});
`,
  "tests/takes-all.test.js": `import { expect, test } from "bun:test";
import * as odd from "../src/odd.js";
test("all of a file that cannot load", () => {
  expect(Object.keys(odd)).toEqual(["own"]);
});
`,
  "tests/takes-a-name.test.js": `import { expect, test } from "bun:test";
import { own } from "../src/odd.js";
test("a name of a file that cannot load", () => {
  expect(own).toBe(1);
});
`,
  "tests/catches.test.js": `import { expect, test } from "bun:test";
test("the load is caught", async () => {
  expect(await import("../src/odd.js").then(() => "loaded", () => "thrown")).toBe("thrown");
});
`,
};

// src/odd.js is well formed. What it imports by a statement is not there or is no program.
const cannotLoad: Record<string, Record<string, string>> = {
  "a file with a syntax error": {
    "src/odd.js": `import { a } from "./broken.js";\nexport const own = 1;\nexport const through = a;\n`,
    "src/broken.js": `export const a = ;\n`,
  },
  "a CommonJS file with a syntax error": {
    "src/odd.js": `import broken from "./broken.cjs";\nexport const own = 1;\nexport const through = broken;\n`,
    "src/broken.cjs": `module.exports = { a: 1 ;\n`,
  },
  "a module of Node that does not exist": {
    "src/odd.js": `import "node:there-is-no-such-module";\nexport const own = 1;\n`,
  },
  "a module of Bun that does not exist": {
    "src/odd.js": `import "bun:there-is-no-such-module";\nexport const own = 1;\n`,
  },
  "an empty name": {
    "src/odd.js": `import "";\nexport const own = 1;\n`,
  },
  "a file that is not there": {
    "src/odd.js": `import "./nothing-there.js";\nexport const own = 1;\n`,
  },
  "a file that imports the healthy one and, two files further, a file with a syntax error": {
    "src/odd.js": `import { good } from "./good.js";\nimport "./between.js";\nexport const own = good().length - 3;\n`,
    "src/between.js": `export * from "./broken.js";\n`,
    "src/broken.js": `export function f() { return 1;\n`,
  },
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./tests"], directory, {
    ...bunEnv,
    ...env,
  });
  const ends = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  const counts = [...stderr.matchAll(/^ *(\d+) (pass|fail|errors?)$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { ends: ends.sort(), counts, exitCode };
}

test.concurrent.each(Object.keys(cannotLoad))("beside a test file that imports %s", async name => {
  using dir = tempDir("aot-beside-a-file-that-cannot-load", { ...healthy, ...cannotLoad[name] });
  const plain = await runTests(String(dir), {});
  expect(plain).toEqual({
    ends: ["pass a healthy file", "pass the load is caught"],
    counts: ["2 pass", "2 fail", "2 errors"],
    exitCode: 1,
  });
  expect(await runTests(String(dir), fromDisk, "--aot")).toEqual(plain);
});
