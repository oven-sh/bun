import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A CommonJS file that is mocked before it loads never runs: the mock stands in place of it, whatever its text stores. A module that is loaded later and imports a name
// that the factory leaves out links, and the name is undefined at each read.
const real = `exports.c = x => x + 1;\nexports.other = 5;\n`;
const reads = (path: string, name = "other") =>
  `import { other${name === "other" ? "" : " as " + name} } from ${JSON.stringify(path)};\nexport const seen = () => String(${name});\n`;

const files: Record<string, string> = {
  "package.json": `{ "name": "names-left-out" }`,
  ...Object.fromEntries(
    [
      "direct",
      "alias",
      "unused",
      "statement",
      "star",
      "deep",
      "named",
      "ran",
      "typed",
      "type",
      "second",
      "later",
      "required",
      "first",
      "last",
    ].map(name => [name + ".cjs", real]),
  ),
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
  "node_modules/pkg/index.js": real,
  "inner1.cjs": real,
  "inner2.cjs": real,
  "inner3.cjs": real,
  "outer1.cjs": `exports.other = require("./inner1.cjs").other;\nexports.c = 1;\n`,
  "outer2.cjs": `exports.other = require("./inner2.cjs").other;\nexports.c = 1;\n`,
  "whole.cjs": `module.exports = require("./inner3.cjs");\n`,
  "user-direct.mjs": reads("./direct.cjs"),
  "user-alias.mjs": reads("./alias.cjs", "renamed"),
  "user-unused.mjs": `import { other } from "./unused.cjs";\nexport const seen = () => "the body ran";\n`,
  "hands-on.mjs": `export { other } from "./statement.cjs";\n`,
  "user-statement.mjs": reads("./hands-on.mjs"),
  "hands-on-all.mjs": `export * from "./star.cjs";\n`,
  "user-star.mjs": reads("./hands-on-all.mjs"),
  "user-deep.mjs": `import { seen as inner } from "./user-deep-inner.mjs";\nconsole.log("THE BODY OF THE OUTER IMPORTER RUNS");\nexport const seen = () => inner();\n`,
  "user-deep-inner.mjs": `console.log("THE BODY OF THE INNER IMPORTER RUNS");\n` + reads("./deep.cjs"),
  "user-named.mjs": `import { c, other } from "./named.cjs";\nexport const seen = () => c(1) + " " + String(other);\n`,
  "user-ran-early.mjs": reads("./ran.cjs"),
  "user-ran-late.mjs": reads("./ran.cjs"),
  "user-outer1.mjs": reads("./outer1.cjs"),
  "user-outer2.mjs": reads("./outer2.cjs"),
  "user-whole.mjs": reads("./whole.cjs"),
  "user-pkg.mjs": reads("pkg"),
  "src/user-typed.ts": `import { other } from "../typed.cjs";\nexport const seen = (): string => String(other);\n`,
  "src/user-of-a-type.ts": `import { Other, c } from "../type.cjs";\nexport const seen = (x?: Other): string => String(c(1));\n`,
  "side1.cjs": `console.log("THE BODY OF side1 RUNS");\nexports.s = 1;\n`,
  "side2.cjs": `console.log("THE BODY OF side2 RUNS");\nexports.s = 1;\n`,
  "es.mjs": `console.log("THE BODY OF es RUNS");\nexport const e = 1;\n`,
  "user-last.mjs": `import { e } from "./es.mjs";\nimport { s } from "./side1.cjs";\nimport { other } from "./last.cjs";\nexport const seen = () => String(other) + s + e;\n`,
  "user-first.mjs": `import { other } from "./first.cjs";\nimport { s } from "./side2.cjs";\nexport const seen = () => String(other) + s;\n`,
  "user-second-a.mjs": reads("./second.cjs"),
  "user-second-b.mjs": `import { c } from "./second.cjs";\nexport const seen = () => c(1);\n`,
  "user-later.mjs": reads("./later.cjs"),
  "user-requires.cjs": `const { other } = require("./required.cjs");\nexports.seen = () => String(other);\n`,
  "mocks.test.mjs": `import { mock, test } from "bun:test";
const say = async (label, load) => {
  let said;
  try {
    said = (await load()).seen();
  } catch (error) {
    said = "THROWS " + error.constructor.name + " " + String(error.message).replace(/'\\/[^']*\\//g, "'");
  }
  console.log(label, "|", said);
};
const fake = () => ({ c: () => "fake" });
mock.module("./direct.cjs", fake);
await say("a name that the mock leaves out", () => import("./user-direct.mjs"));
await say("the same importer once more", () => import("./user-direct.mjs"));
mock.module("./alias.cjs", fake);
await say("under another name", () => import("./user-alias.mjs"));
mock.module("./unused.cjs", fake);
await say("a name that nobody reads", () => import("./user-unused.mjs"));
mock.module("./statement.cjs", fake);
await say("through an export statement", () => import("./user-statement.mjs"));
mock.module("./star.cjs", fake);
await say("through a star", () => import("./user-star.mjs"));
mock.module("./deep.cjs", fake);
await say("two modules down", () => import("./user-deep.mjs"));
mock.module("./named.cjs", () => ({ c: () => "fake", other: "the mock's" }));
await say("the mock names it", () => import("./user-named.mjs"));
await say("before the mock", () => import("./user-ran-early.mjs"));
mock.module("./ran.cjs", fake);
await say("a file that has run keeps its names", () => import("./user-ran-late.mjs"));
mock.module("./outer1.cjs", fake);
await say("a name that the file takes from another file", () => import("./user-outer1.mjs"));
mock.module("./outer2.cjs", () => ({ other: "the mock's" }));
await say("such a name, and the mock names it", () => import("./user-outer2.mjs"));
mock.module("./whole.cjs", fake);
await say("a file that exports what another file exports", () => import("./user-whole.mjs"));
mock.module("pkg", fake);
await say("a package", () => import("./user-pkg.mjs"));
mock.module("./typed.cjs", fake);
await say("a TypeScript importer", () => import("./src/user-typed.ts"));
mock.module("./type.cjs", fake);
await say("a TypeScript importer names a type", () => import("./src/user-of-a-type.ts"));
mock.module("./last.cjs", fake);
await say("another file of the graph, imported first", () => import("./user-last.mjs"));
mock.module("./first.cjs", fake);
await say("another file of the graph, imported behind it", () => import("./user-first.mjs"));
mock.module("./second.cjs", fake);
await say("one importer fails", () => import("./user-second-a.mjs"));
await say("and another one does not", () => import("./user-second-b.mjs"));
mock.module("./later.cjs", async () => ({ c: 1 }));
await say("an async factory", () => import("./user-later.mjs"));
mock.module("./required.cjs", fake);
await say("a CommonJS file that requires it reads undefined", () => import("./user-requires.cjs"));
test("ran", () => {});
`,
};

test("it says what plain Bun says, as one program and in layers", async () => {
  using dir = tempDir("aot-name-that-a-mock-of-a-commonjs-file-leaves-out", files);
  const directory = String(dir);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags], directory, env);
    return {
      lines: ran.stdout.split("\n").filter(line => line.includes(" | ") || line.includes("THE BODY")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 1 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(27);
  expect(plain.lines).toContain("a name that the mock leaves out | undefined");
  expect(plain.lines).toContain("a file that has run keeps its names | 5");
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);

test("a test file that imports the name says what plain Bun says, as one program and in layers", async () => {
  using dir = tempDir("aot-name-that-a-mock-in-a-preload-leaves-out", {
    "package.json": `{ "name": "names-left-out-by-a-preload" }`,
    "mocked.cjs": real,
    "preload.mjs": `import { mock } from "bun:test";\nmock.module("./mocked.cjs", () => ({ c: () => "fake" }));\n`,
    "left-out.test.mjs": `import { test } from "bun:test";\nimport { other } from "./mocked.cjs";\nconsole.log("THE BODY OF THE TEST FILE RUNS", String(other));\ntest("ran", () => {});\n`,
    "named.test.mjs": `import { test } from "bun:test";\nimport { c } from "./mocked.cjs";\nconsole.log("named |", c(1));\ntest("ran", () => {});\n`,
  });
  const directory = String(dir);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags, "--preload", "./preload.mjs"], directory, env);
    const lines = (ran.stdout + ran.stderr).split("\n").map(line => line.replaceAll(directory + "/", ""));
    return lines.filter(line => /^ *\d+ (pass|fail|error)$|Error: |^named \| |THE BODY/.test(line)).sort();
  };
  const plain = await said([], "");
  expect(plain).toEqual([" 0 fail", " 2 pass", "THE BODY OF THE TEST FILE RUNS undefined", "named | fake"]);
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
