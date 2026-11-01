import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const file = `exports.fs = () => typeof require("fs").readFileSync;`;
const head = `import { test } from "bun:test";`;

const project = {
  "package.json": `{}`,
  "import-first.cjs": file,
  "require-first.cjs": file,
  "require-before-graph.cjs": file,
  "graph.mjs": `export * as file from "./require-before-graph.cjs";`,
  "import-beside-sibling.cjs": file,
  "sibling.mjs": `export const early = require("./import-beside-sibling.cjs");`,
  "inner.cjs": file,
  "require-at-top.cjs": file,
  "outer.cjs": `exports.inner = require("./inner.cjs"); ${file}`,
  "required-by-first-test.cjs": file,
  "imported-by-first-test.cjs": file,
  "never-asked-by-first-test.cjs": file,
  "import-behind-mock.cjs": file,
  "import-behind-plugin.cjs": file,
  "preload.cjs": `globalThis.preloaded = () => typeof require("fs").readFileSync;`,
  "1.test.js": `${head}
    import { early } from "./sibling.mjs";
    import * as besideSibling from "./import-beside-sibling.cjs";
    import * as outer from "./outer.cjs";
    import * as imported from "./imported-by-first-test.cjs";
    const atTop = require("./require-at-top.cjs");
    test("one file, two kinds of load", async () => {
      const importFirst = [await import("./import-first.cjs"), require("./import-first.cjs")];
      const requireFirst = [require("./require-first.cjs"), await import("./require-first.cjs")];
      const beforeGraph = [require("./require-before-graph.cjs"), (await import("./graph.mjs")).file];
      const required = require("./required-by-first-test.cjs");
      require("./never-asked-by-first-test.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("import() then require():", importFirst[0].fs(), importFirst[1].fs());
      console.log("require() then import():", requireFirst[0].fs(), requireFirst[1].fs());
      console.log("require() then a module that imports it:", beforeGraph[0].fs(), beforeGraph[1].fs());
      console.log("imported, and required by a module in front of it:", besideSibling.fs(), early.fs());
      console.log("imported, and what it requires:", outer.fs(), outer.inner.fs());
      console.log("required at the top of a module:", atTop.fs());
      console.log("a preload:", preloaded());
      console.log("first test file:", required.fs(), imported.fs());
      delete require.cache["fs"];
    });`,
  "2.test.js": `${head}
    import * as imported from "./required-by-first-test.cjs";
    import * as neverAsked from "./never-asked-by-first-test.cjs";
    test("the other kind of load in the next test file", () => {
      const required = require("./imported-by-first-test.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("second test file:", imported.fs(), required.fs(), neverAsked.fs());
      delete require.cache["fs"];
    });`,
  "3.test.cjs": `const { test } = require("bun:test");
    test("a test file that is a CommonJS file", () => {
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("started by the runner:", typeof require("fs").readFileSync);
      delete require.cache["fs"];
    });`,
  "4.test.js": `${head}
    import { fs } from "./5.test.cjs";
    test("a test file that imports the next one", () => {
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("imported before the runner starts it:", fs());
      delete require.cache["fs"];
    });`,
  "6.test.js": `import { mock, test } from "bun:test";
    test("a mock and a plugin", async () => {
      mock.module("./mocked.cjs", () => ({}));
      const behindMock = await import("./import-behind-mock.cjs");
      Bun.plugin({ name: "nothing", setup: build => void build.onLoad({ filter: /[.]nothing$/ }, () => ({ contents: "" })) });
      const behindPlugin = await import("./import-behind-plugin.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("import() behind a mock, and behind a plugin:", behindMock.fs(), behindPlugin.fs());
      delete require.cache["fs"];
    });`,
  "5.test.cjs": `const { test } = require("bun:test");
    ${file}
    test("a test file that the one before has imported", () => {
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("in a test of its own:", exports.fs());
      delete require.cache["fs"];
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:6" }],
  ["with the test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--preload", "./preload.cjs", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

for (const isolation of [["--isolate"], []]) {
  for (const [way, env] of ways) {
    const name = `the first load of a CommonJS file decides how it reads require("fs"), ${way}`;
    test.concurrent(isolation.length ? `${name}, isolated` : name, async () => {
      using dir = tempDir("a-commonjs-file-loaded-by-import-and-by-require", project);
      const plain = await runTests(String(dir), {}, ...isolation);
      expect(plain.printed).toEqual([
        "import() then require(): function function",
        "require() then import(): number number",
        "require() then a module that imports it: number number",
        "imported, and required by a module in front of it: function function",
        "imported, and what it requires: function number",
        "required at the top of a module: number",
        "a preload: number",
        "first test file: number function",
        "second test file: number function number",
        "started by the runner: number",
        "in a test of its own: function",
        "imported before the runner starts it: function",
        ...(isolation.length ? ["in a test of its own: number"] : []),
        "import() behind a mock, and behind a plugin: function function",
      ]);
      expect(await runTests(String(dir), env, "--aot", ...isolation)).toEqual(plain);
    });
  }
}

test.concurrent(
  "in layers with a process for each test file, the first load of the run decides as in one process",
  async () => {
    using dir = tempDir("a-commonjs-file-loaded-by-import-and-by-require-in-two-processes", project);
    const plain = await runTests(String(dir), {}, "--isolate");
    expect(plain.printed).toContain("second test file: number function number");
    const words = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
    expect(await runTests(String(dir), words, "--aot", "--isolate")).toEqual(plain);
  },
);
