// What only a mocked module imports is not loaded: that is what such a mock is laid for. Where the loader of the host walks a graph, over layers and
// behind a way back through require(), a CommonJS file ran although its one importer was mocked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const main = (lib: string) => `import { v } from "./${lib}";\nconsole.log("SEEN main", v);\n`;
const hoisted = (lib: string) => `import { test, vi } from "bun:test";
import "./main.mjs";
vi.mock("./${lib}", () => ({ v: "mock v" }));
test("t", () => {});
`;
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
};

async function runTests(directory: string, words: string | undefined, flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [name, files] of Object.entries(projects)) {
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
      expect(plain.stdout[0]).toStartWith(name.startsWith("another file") ? "SEEN driver runs" : "SEEN main mock v");
      for (const words of ["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2"])
        expect({ words, ...(await runTests(String(dir), words, ["--aot"])) }).toEqual({ words, ...plain });
      const parallel = await runTests(String(dir), undefined, ["--parallel=2"]);
      expect(await runTests(String(dir), undefined, ["--aot", "--parallel=2", "--aot-memory-limit=1KB"])).toEqual(
        parallel,
      );
    },
    300_000,
  );
}
