// What only a mocked module imports is not loaded: that is what such a mock is laid for. Where the loader of the host walks a graph, over layers and
// behind a way back through require(), a CommonJS file ran although its one importer was mocked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./run";
import { test } from "../supported";

const main = (lib: string) => `import { v } from "./${lib}";\nconsole.log("SEEN main", v);\n`;
const hoisted = (lib: string) => `import { test, vi } from "bun:test";
import "./main.mjs";
vi.mock("./${lib}", () => ({ v: "mock v" }));
test("t", () => {});
`;
const inTest = (mocked: string, body: string, exports = `{ v: "mock v" }`) => `import { mock, test } from "bun:test";
test("t", async () => {
  mock.module("./${mocked}", () => (${exports}));
  ${body}
});
`;
const list = (name: string) =>
  `const ns = await import("${name}");\n  console.log("SEEN main mock v", Object.keys(ns).join(), ns.v, ns.d, ns.extra);`;
const lib = `import d from "driver";\nconsole.log("SEEN lib runs");\nexport let v = "real v" + d.d;\n`;
const driver = (body: string, type = "commonjs") => ({
  "node_modules/driver/package.json": `{ "name": "driver", "main": "./index.js", "type": "${type}" }`,
  "node_modules/driver/index.js": `console.log("SEEN driver runs");\n${body}\n`,
});

const projects: Record<string, Record<string, string>> = {
  "a CommonJS package": { "a.test.mjs": hoisted("lib.mjs"), ...driver(`exports.d = 1;`) },
  "a package that throws at its load": {
    "a.test.mjs": hoisted("lib.mjs"),
    ...driver(`throw new Error("no database here");`),
  },
  "mock.module() in a test": {
    "a.test.mjs": `import { mock, test } from "bun:test";
test("t", async () => {
  mock.module("./lib.mjs", () => ({ v: "mock v" }));
  await import("./main.mjs");
});
`,
    ...driver(`exports.d = 1;`),
  },
  "what the package requires": {
    "a.test.mjs": hoisted("lib.mjs"),
    ...driver(`exports.d = require("deep").n;`),
    "node_modules/deep/package.json": `{ "name": "deep", "main": "./index.js" }`,
    "node_modules/deep/index.js": `console.log("SEEN deep runs");\nexports.n = 1;\n`,
  },
  "an ES package": { "a.test.mjs": hoisted("lib.mjs"), ...driver(`export default { d: 1 };`, "module") },
  "another file imports the package too": {
    "a.test.mjs": hoisted("lib.mjs"),
    "main.mjs": `import { v } from "./lib.mjs";\nimport d from "driver";\nconsole.log("SEEN main", v, d.d);\n`,
    ...driver(`exports.d = 1;`),
  },
  // A way back through require() sends the graph to the loader of the run time.
  ...Object.fromEntries(
    Object.entries({
      "in a function that nobody calls": `exports.late = () => require("./lib.mjs").v;`,
      "in its body": `exports.lib = require("./lib.mjs");`,
      "by a name made at run time": `exports.v = require("./" + String("lib") + ".mjs").v;`,
      "by a name made at run time, and its importer": `exports.names = Object.keys(require("./" + String("main") + ".mjs"));`,
    }).map(([where, body]) => [
      `a file of the project that requires the mocked module back ${where}`,
      {
        "a.test.mjs": hoisted("lib.mjs"),
        "lib.mjs": `import "./driver.cjs";\nconsole.log("SEEN lib runs");\nexport let v = "real v";\n`,
        "driver.cjs": `console.log("SEEN driver runs");\n${body}\n`,
      },
    ]),
  ),
  "the next test file has no mock": {
    "a.test.mjs": hoisted("lib.mjs"),
    "b.test.mjs": `import { test } from "bun:test";\nimport { v } from "./lib.mjs";\ntest("t", () => console.log("SEEN b", v));\n`,
    ...driver(`exports.d = 1;`),
  },
  // The mock has ended, and the module runs for an importer that ran while it stood. Nothing has loaded the package by then.
  "the next test file imports only a user of the module": {
    "main.mjs": `import { v } from "./lib.mjs";\nexport const read = () => v;\n`,
    "a.test.mjs": inTest("lib.mjs", `console.log("SEEN main", (await import("./main.mjs")).read());`),
    "b.test.mjs": `import { test } from "bun:test";\nimport { read } from "./main.mjs";\ntest("t", () => console.log("SEEN b", read()));\n`,
    ...driver(`exports.d = 1;`),
  },
  "what a first mock kept from running stands below a second mock": {
    "root.mjs": `import { v } from "./lib.mjs";\nconsole.log("SEEN root", v);\n`,
    "lib.mjs": `import { x } from "./x.mjs";\nexport let v = "lib " + x;\n`,
    "x.mjs": `console.log("SEEN x runs");\nexport let x = "real x";\n`,
    "a.test.mjs": inTest("x.mjs", `console.log("SEEN main mock v", (await import("./lib.mjs")).v);`, `{ x: "mock x" }`),
    "b.test.mjs": inTest("lib.mjs", `await import("./root.mjs");`),
  },
  // Such a mock has no `export *`.
  ...Object.fromEntries(
    Object.entries({
      "is imported": { "a.test.mjs": inTest("lib.mjs", list("./lib.mjs")) },
      "is passed on by another star": {
        "index.mjs": `export * from "./lib.mjs";\nexport let own = 1;\n`,
        "a.test.mjs": inTest("lib.mjs", list("./index.mjs")),
      },
      "stars a file of the project": {
        "lib.mjs": `export * from "./driver.cjs";\nconsole.log("SEEN lib runs");\nexport let v = "real v";\n`,
        "driver.cjs": `console.log("SEEN driver runs");\nexports.d = 1;\n`,
        "index.mjs": `export * from "./lib.mjs";\n`,
        "a.test.mjs": inTest("lib.mjs", list("./index.mjs")),
      },
      "gets a name from the mock that the package has too": {
        "a.test.mjs": inTest("lib.mjs", list("./lib.mjs"), `{ v: "mock v", extra: 7, d: "mock d" }`),
      },
      "stands beside a star that is followed": {
        "index.mjs": `export * from "./lib.mjs";\nexport * from "second";\n`,
        "node_modules/second/package.json": `{ "name": "second", "main": "./index.js" }`,
        "node_modules/second/index.js": `console.log("SEEN second runs");\nexports.s = 3;\n`,
        "a.test.mjs": inTest("lib.mjs", list("./index.mjs")),
      },
      "has its stars again in the next test file": {
        "a.test.mjs": inTest("lib.mjs", list("./lib.mjs")),
        "b.test.mjs": `import { test } from "bun:test";\nimport * as ns from "./lib.mjs";\ntest("t", () => console.log("SEEN b", Object.keys(ns).join(), ns.v, ns.d));\n`,
      },
      "was loaded before the mock": {
        "a.test.mjs": `import { mock, test } from "bun:test";
import * as ns from "./lib.mjs";
test("t", () => {
  mock.module("./lib.mjs", () => ({ v: "mock v" }));
  console.log("SEEN main mock v", Object.keys(ns).join(), ns.v, ns.d);
});
`,
      },
    }).map(([what, files]) => [
      `a mocked module with a star over a package ${what}`,
      {
        "lib.mjs": `export * from "driver";\nconsole.log("SEEN lib runs");\nexport let v = "real v";\n`,
        ...driver(`exports.d = 1;`),
        ...files,
      },
    ]),
  ),
};

async function runTests(directory: string, words: string | undefined, flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

/**
 * Every case builds its project four times, three of them in layers: under a sanitizer minutes of processor time.
 * So the cases are dealt to several test files: of `of` files, this one takes every `of`-th case, from the `part`-th on.
 */
export function mockHidesPackages(part: number, of: number) {
  for (const [name, files] of Object.entries(projects).filter((_, index) => index % of === part)) {
    test.concurrent(
      name,
      async () => {
        using dir = tempDir("aot-mock-hides-packages", {
          "package.json": `{ "name": "p" }`,
          "lib.mjs": lib,
          "main.mjs": main("lib.mjs"),
          ...files,
        });
        const plain = await runTests(String(dir), undefined, []);
        expect(plain.exitCode).toBe(0);
        const first = /^another file|was loaded before/.test(name)
          ? "driver runs"
          : name.endsWith("that is followed")
            ? "second runs"
            : "main mock v";
        expect(plain.stdout[0]).toStartWith("SEEN " + first);
        for (const words of ["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2"])
          expect({ words, ...(await runTests(String(dir), words, ["--aot"])) }).toEqual({ words, ...plain });
        // Two workers print their files as they end.
        const sorted = ({ stdout, exitCode }: typeof plain) => ({ stdout: stdout.toSorted(), exitCode });
        const parallel = await runTests(String(dir), undefined, ["--parallel=2"]);
        expect(
          sorted(await runTests(String(dir), undefined, ["--aot", "--parallel=2", "--aot-memory-limit=1KB"])),
        ).toEqual(sorted(parallel));
      },
      300_000,
    );
  }
}
