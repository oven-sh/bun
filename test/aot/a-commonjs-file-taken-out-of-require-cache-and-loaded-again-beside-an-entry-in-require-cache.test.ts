import { expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const file = `exports.fs = () => typeof require("fs").readFileSync;`;
const head = `import { test } from "bun:test";`;
const forget = (name: string) => `delete require.cache[require.resolve("${name}")]`;

const project = {
  "package.json": `{}`,
  "require-import.cjs": file,
  "import-import.cjs": file,
  "import-require.cjs": file,
  "require-require.cjs": file,
  "require-graph.cjs": file,
  "graph.mjs": `export * as file from "./require-graph.cjs";`,
  "require-statement.cjs": file,
  "statement.mjs": `import { fs } from "./require-statement.cjs"; export { fs };`,
  "below-required-graph.cjs": file,
  "required-graph.mjs": `export * as file from "./below-required-graph.cjs";`,
  "last-imported.cjs": file,
  "last-required.cjs": file,
  "not-loaded-again.cjs": file,
  "first-requires.cjs": file,
  "first-imports.cjs": file,
  "1.test.js": `${head}
    import * as firstImports from "./first-imports.cjs";
    test("a file is loaded, taken out of require.cache and loaded again", async () => {
      const requireImport = [require("./require-import.cjs"), ${forget("./require-import.cjs")}, await import("./require-import.cjs")];
      const importImport = [await import("./import-import.cjs"), ${forget("./import-import.cjs")}, await import("./import-import.cjs")];
      const importRequire = [await import("./import-require.cjs"), ${forget("./import-require.cjs")}, require("./import-require.cjs")];
      const requireRequire = [require("./require-require.cjs"), ${forget("./require-require.cjs")}, require("./require-require.cjs")];
      const requireGraph = [require("./require-graph.cjs"), ${forget("./require-graph.cjs")}, (await import("./graph.mjs")).file];
      const requireStatement = [require("./require-statement.cjs"), ${forget("./require-statement.cjs")}, await import("./statement.mjs")];
      const belowRequiredGraph = require("./required-graph.mjs").file;
      require("./last-imported.cjs"); ${forget("./last-imported.cjs")}; await import("./last-imported.cjs");
      await import("./last-required.cjs"); ${forget("./last-required.cjs")}; require("./last-required.cjs");
      require("./not-loaded-again.cjs"); ${forget("./not-loaded-again.cjs")};
      const firstRequires = require("./first-requires.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      const both = ([first, , second]) => [first.fs(), second.fs(), first.fs === second.fs].join(" ");
      console.log("require(), then import():", both(requireImport));
      console.log("import(), then import():", both(importImport));
      console.log("import(), then require():", both(importRequire));
      console.log("require(), then require():", both(requireRequire));
      console.log("require(), then a module that exports it:", both(requireGraph));
      console.log("require(), then a module that imports from it:", both(requireStatement));
      console.log("below a module that is required:", belowRequiredGraph.fs());
      console.log("first test file:", firstRequires.fs(), firstImports.fs());
      delete require.cache["fs"];
    });`,
  "2.test.js": `${head}
    import * as firstRequires from "./first-requires.cjs";
    test("the next test file loads them the other way", async () => {
      const notLoadedAgain = await import("./not-loaded-again.cjs");
      const lastRequired = await import("./last-required.cjs");
      const lastImported = require("./last-imported.cjs");
      const firstImports = require("./first-imports.cjs");
      const belowRequiredGraph = await import("./below-required-graph.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("last loaded by import(), by require(), by nobody:", lastImported.fs(), lastRequired.fs(), notLoadedAgain.fs());
      console.log("second test file:", firstRequires.fs(), firstImports.fs(), belowRequiredGraph.fs());
      delete require.cache["fs"];
    });`,
  "3.test.js": `${head}
    test("and the one after it the first way", async () => {
      const lastImported = await import("./last-imported.cjs");
      const firstImports = await import("./first-imports.cjs");
      const firstRequires = require("./first-requires.cjs");
      const lastRequired = await import("./last-required.cjs");
      const notLoadedAgain = require("./not-loaded-again.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("third test file:", firstRequires.fs(), firstImports.fs(), lastImported.fs(), lastRequired.fs(), notLoadedAgain.fs());
      delete require.cache["fs"];
    });`,
};

// What `bun test` prints and reports for the project, plain or compiled, with --isolate or without.
const expected = {
  printed: [
    "bun test <version> (<revision>)",
    "require(), then import(): number function false",
    "import(), then import(): function function false",
    "import(), then require(): function number false",
    "require(), then require(): number number false",
    "require(), then a module that exports it: number function false",
    "require(), then a module that imports from it: number function false",
    "below a module that is required: number",
    "first test file: number function",
    "last loaded by import(), by require(), by nobody: function number function",
    "second test file: number function number",
    "third test file: number function function number function",
  ],
  reported: [
    "1.test.js:",
    "(pass) a file is loaded, taken out of require.cache and loaded again",
    "2.test.js:",
    "(pass) the next test file loads them the other way",
    "3.test.js:",
    "(pass) and the one after it the first way",
    " 3 pass",
    " 0 fail",
    "Ran 3 tests across 3 files.",
  ],
  exitCode: 0,
};

// A way: its name, the environment of its compiled runs, what such a run says of its form, and the flags of each run. A run says
// its form on stderr where a word of BUN_DEBUG_TEST_AOT_WORDS begins with `TestRun`. The text here is the part of that line that
// every Bun prints: one that loads one program a realm (macOS, Windows, a hardened build) says so in place of the layers.
const ways: [string, Record<string, string> | undefined, string, string[][]][] = [
  ["in plain Bun", undefined, "", [["--isolate"], []]],
  [
    "as one program",
    { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" },
    "AOT test run | one program",
    [["--isolate"], []],
  ],
  [
    "in layers",
    { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:3" },
    " | test files 3 | to a program 3",
    [["--isolate"]],
  ],
  [
    "in layers with a process for each test file",
    { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
    " | test files 3 | to a program 1",
    [["--isolate"]],
  ],
  [
    "with the test files from disk",
    { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" },
    "",
    [["--isolate"], []],
  ],
];

async function runTests(directory: string, env: Record<string, string> | undefined, ...flags: string[]) {
  const command = [bunExe(), "test", ...(env ? ["--aot"] : []), ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  // Every line, without the version and the times.
  const lines = (text: string) => normalizeBunSnapshot(text, directory).split("\n").filter(Boolean);
  const saysForm = (line: string) => line.startsWith("AOT test run | ");
  const reported = lines(stderr);
  return {
    form: reported.filter(saysForm).join("\n"),
    output: { printed: lines(stdout), reported: reported.filter(line => !saysForm(line)), exitCode },
  };
}

for (const [way, env, says, isolations] of ways) {
  for (const isolation of isolations) {
    const name = `each load of a CommonJS file decides how that load reads require("fs"), and the last one for the test files to come, ${way}`;
    test.concurrent(isolation.length ? `${name}, isolated` : name, async () => {
      using dir = tempDir("a-commonjs-file-taken-out-of-require-cache-and-loaded-again", project);
      const { form, output } = await runTests(String(dir), env, ...isolation);
      expect(output).toEqual(expected);
      expect(form).toContain(says);
    });
  }
}
