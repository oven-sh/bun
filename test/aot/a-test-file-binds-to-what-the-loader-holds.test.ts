import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { describe, test as oneAtATime } from "./supported";

// The tests run at once: each builds and runs in a folder of its own.
const test = oneAtATime.concurrent;
// They share the processors, so one may take as long as the whole file: minutes with a debug build.
raiseDefaultTimeout(isDebug ? 3_600_000 : 600_000);

// An import statement is bound to the module that the loader holds when the importer is linked. The runner starts a test file behind the test files and the preloads
// before it, and one of those may have taken a file out of require.cache: then the statement and a require() of the path name one module, the one from disk.
const state = `let calls = 0;\nexport const bump = () => ++calls;\n`;
const takesOut = `import { test } from "bun:test";
import { bump } from "./state.js";
test("takes it out", () => {
  console.log("first", bump(), bump());
  delete require.cache[require.resolve("./state.js")];
});
`;
const importsIt = `import { test } from "bun:test";
import { bump } from "./state.js";
import * as all from "./state.js";
test("imports it", () => {
  const required = require(require.resolve("./state.js"));
  console.log("second", bump(), required.bump(), all.bump(), required.bump === bump);
});
`;

const ways = [
  { way: "as one program", words: "TestRunLayers:0" },
  { way: "over two layers", words: "TestRunLayers:2,TestRunPartFiles:1" },
];

/** What `bun test <flags>` prints: its stdout behind the line that names Bun, and of its stderr each test with its verdict, each count and each line that begins with an error. */
async function printed(cwd: string, flags: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], cwd, { ...bunEnv, ...env });
  // A run that is asked to be one program says that it is, as run() asks a run over layers for its layers.
  if (env.BUN_DEBUG_TEST_AOT_WORDS === "TestRunLayers:0") expect(stderr).toMatch(/^AOT test run \| one program\b/m);
  return {
    stdout: stdout.replace(/^bun test .*\n/, ""),
    results: stderr
      .split("\n")
      .filter(line => /^(\((pass|fail|skip|todo)\) |\w*[Ee]rror\b| *\d+ (pass|fail)$)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    exitCode,
  };
}

describe.each(ways)("$way", ({ words }) => {
  test("behind the test file that took it out", async () => {
    using dir = tempDir("aot-test-file-binds-late", {
      "package.json": `{ "type": "module" }`,
      "state.js": state,
      "a.test.js": takesOut,
      "b.test.js": importsIt,
    });
    const plain = await printed(String(dir), ["./a.test.js", "./b.test.js"], {});
    expect(plain).toEqual({
      stdout: "first 1 2\nsecond 1 2 3 true\n",
      results: ["(pass) takes it out", "(pass) imports it", " 2 pass", " 0 fail"],
      exitCode: 0,
    });
    const compiled = await printed(String(dir), ["--aot", "./a.test.js", "./b.test.js"], {
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    expect(compiled).toEqual(plain);
  });

  test("behind a preload that took it out, each file in its own realm", async () => {
    using dir = tempDir("aot-test-file-binds-late", {
      "package.json": `{ "type": "module" }`,
      "state.js": state,
      "preload.js": `import { bump } from "./state.js";\nconsole.log("preload", bump());\ndelete require.cache[require.resolve("./state.js")];\n`,
      "b.test.js": importsIt,
    });
    const flags = ["--isolate", "--preload", "./preload.js", "./b.test.js"];
    const plain = await printed(String(dir), flags, {});
    expect(plain).toEqual({
      stdout: "preload 1\nsecond 1 2 3 true\n",
      results: ["(pass) imports it", " 1 pass", " 0 fail"],
      exitCode: 0,
    });
    expect(await printed(String(dir), ["--aot", ...flags], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
  });
});

// app.mjs was linked with the first load of the CommonJS file and keeps its namespace object, whoever reads it off app.mjs and however: the test file reads `app.space`
// off an object that the loader handed it.
test.each(ways)("what a module exports of a CommonJS file stays when the file loads again: $way", async ({ words }) => {
  using dir = tempDir("aot-test-file-binds-late", {
    "package.json": `{ "type": "module" }`,
    "counter.cjs": `globalThis.loads = (globalThis.loads ?? 0) + 1;\nexports.load = globalThis.loads;\n`,
    "app.mjs": `import * as space from "./counter.cjs";\nexport { space };\n`,
    "a.test.js": `import { test } from "bun:test";
import * as app from "./app.mjs";
import * as mine from "./counter.cjs";
test("loads again", () => {
  const held = app.space;
  const before = require("./counter.cjs");
  delete require.cache[require.resolve("./counter.cjs")];
  const after = require("./counter.cjs");
  console.log("first", before.load, after.load, held === app.space, app.space === mine, app.space.default === before, mine.default === before);
});
`,
  });
  const plain = await printed(String(dir), ["./a.test.js"], {});
  expect(plain).toEqual({
    stdout: "first 1 2 true true true true\n",
    results: ["(pass) loads again", " 1 pass", " 0 fail"],
    exitCode: 0,
  });
  expect(await printed(String(dir), ["--aot", "./a.test.js"], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
});

// What the loader links beside what compiled code runs. An empty test file first, so that the second is no entry point of the realm.
const empty = `import { test } from "bun:test";\ntest("first", () => {});\n`;
test.each(ways)(
  "a later test file imports a file that a CommonJS file of its imports requires: $way",
  async ({ words }) => {
    using dir = tempDir("aot-test-file-binds-late", {
      "package.json": `{ "type": "module" }`,
      "state.js": `export const v = 1;\n`,
      "mixed.cjs": `const state = require("./state.js");\nexports.w = state.v;\n`,
      "other.js": `export const m = 2;\n`,
      "a.test.js": empty,
      "b.test.js": `import { test } from "bun:test";
import * as state from "./state.js";
import * as mixed from "./mixed.cjs";
console.log("first", state.v, mixed.w, mixed.default.w);
test("t", () => {});
if (globalThis.never) await import("./other.js?0");
`,
    });
    const flags = ["./a.test.js", "./b.test.js"];
    const plain = await printed(String(dir), flags, {});
    expect(plain).toEqual({
      stdout: "first 1 1 1\n",
      results: ["(pass) first", "(pass) t", " 2 pass", " 0 fail"],
      exitCode: 0,
    });
    expect(await printed(String(dir), ["--aot", ...flags], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
  },
);

test.each(ways)(
  "the first CommonJS file that the loader comes to in a later test file has no parent: $way",
  async ({ words }) => {
    using dir = tempDir("aot-test-file-binds-late", {
      "package.json": `{ "type": "module" }`,
      "c.cjs": `exports.about = () => [typeof module.parent, module.parent === null, module.id === "."];\n`,
      "a.test.js": empty,
      "b.test.js": `import { test } from "bun:test";
import c from "./c.cjs";
test("t", () => { console.log("first", ...c.about()); });
test("may take it out", () => { delete require.cache[require.resolve("./c.cjs")]; });
`,
    });
    const flags = ["./a.test.js", "./b.test.js"];
    const plain = await printed(String(dir), flags, {});
    expect(plain).toEqual({
      stdout: "first object true true\n",
      results: ["(pass) first", "(pass) t", "(pass) may take it out", " 3 pass", " 0 fail"],
      exitCode: 0,
    });
    expect(await printed(String(dir), ["--aot", ...flags], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
  },
);

// A test file under a tsconfig.json of its own is lowered as a program of its own. It and the program of the run must say the same of its statements.
test.each(ways)("a test file under a tsconfig.json of its own: $way", async ({ words }) => {
  using dir = tempDir("aot-test-file-binds-late", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "a.test.js": empty,
    "x/tsconfig.json": `{ "compilerOptions": { "strict": false } }`,
    "x/barrel.mjs": `export * from "./dist/index.js";\n`,
    "x/dist/index.js": `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nconst middle = require("./middle");\nexports.renamed = middle.options;\n`,
    "x/dist/middle.js": `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nconst inner = require("./inner");\nexports.options = inner.options;\n`,
    "x/dist/inner.js": `"use strict";\ntry {\n  globalThis.seen = typeof require("./index.js").renamed;\n} catch (error) {\n  globalThis.seen = error.constructor.name;\n}\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.options = { a: 1 };\n`,
    "x/main.test.ts": `import { test } from "bun:test";\nimport { renamed } from "./barrel.mjs";\nconsole.log("first", typeof renamed);\ntest("x", () => {});\n`,
  });
  const flags = ["./a.test.js", "./x/main.test.ts"];
  const plain = await printed(String(dir), flags, {});
  expect(plain).toEqual({
    stdout: "first object\n",
    results: ["(pass) first", "(pass) x", " 2 pass", " 0 fail"],
    exitCode: 0,
  });
  expect(await printed(String(dir), ["--aot", ...flags], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
});

// That a file MAY be taken out costs a test file's start next to nothing. The loader links the statements of the test files and of the preloads. It does not go through
// the graph below them module by module: compiled code runs that. Once every import statement of a layer was handed to it, which cost a large application 1.5 s of
// processor time for each test file.
describe("the loader does not walk what stands below the preloads", () => {
  const moduleCount = 40;
  const testFileCount = 4;
  const graph: Record<string, string> = {};
  for (let i = 0; i < moduleCount; i++) {
    const below = [2 * i + 1, 2 * i + 2].filter(index => index < moduleCount);
    graph[`src/m${i}.ts`] =
      below.map(index => `import { v${index} } from "./m${index}.ts";\n`).join("") +
      `export const v${i}: number = ${i}${below.map(index => ` + v${index}`).join("")};\n`;
  }
  const project = (takesAnyFileOut: boolean) => ({
    "package.json": `{ "type": "module" }`,
    ...graph,
    "preload.ts": `import { v0 } from "./src/m0.ts";\n(globalThis as any).preloaded = v0;\n`,
    ...Object.fromEntries(
      Array.from({ length: testFileCount }, (_, index) => [
        `t${index}.test.ts`,
        `import { expect, test } from "bun:test";\nimport { v${index + 1} } from "./src/m${index + 1}.ts";\ntest("t${index}", () => { expect(typeof v${index + 1}).toBe("number"); });\n`,
      ]),
    ),
    "last.test.ts": `import { expect, test } from "bun:test";
test("last", () => {
  const name = ["src", "m5.ts"].join("/");
  ${takesAnyFileOut ? `delete require.cache[require.resolve("./" + name)];` : ""}
  expect(name).toBe("src/m5.ts");
});
`,
  });

  async function walked(files: Record<string, string>, words: string) {
    using dir = tempDir("aot-loader-walks-nothing", files);
    const cwd = String(dir);
    const said = await printed(cwd, ["--aot", "--isolate", "--preload", "./preload.ts"], {
      BUN_DEBUG_TEST_AOT_WORDS: words,
      [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
    });
    const counts = readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => line.endsWith("\tcounter:CompiledModulesWalkedByLoader"))
      .map(line => Number(line.split("\t")[0]));
    return {
      ...said,
      // A folder is run in the order in which it is read.
      results: said.results.sort(),
      walked: counts.reduce((sum, count) => sum + count, 0),
      processesThatCounted: counts.length > 0,
    };
  }

  test.each(ways)("$way", async ({ words }) => {
    const [without, withIt] = await Promise.all([walked(project(false), words), walked(project(true), words)]);
    const ran = {
      stdout: "",
      results: [" 0 fail", " 5 pass", "(pass) last", "(pass) t0", "(pass) t1", "(pass) t2", "(pass) t3"],
      exitCode: 0,
      processesThatCounted: true,
    };
    expect(without).toMatchObject(ran);
    expect(withIt).toMatchObject(ran);
    // One realm for each test file, and forty modules below the preload in each.
    expect(withIt.walked).toBeLessThanOrEqual(without.walked + testFileCount + 1);
    expect(withIt.walked).toBeLessThan(moduleCount);
  });
});
