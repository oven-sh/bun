// `mock.module("./lib", factory); Bun.plugin.clearAll(); await import("./user")`: the mock is gone before anything has loaded the module, so the module itself loads.
// A compiled run forgot the mock and went on holding back the module's body: the importer read "Cannot access 'v' before initialization", and require() answered undefined.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const head = `import { jest, mock, test } from "bun:test";\n`;
const files = {
  "package.json": `{ "name": "mock-clear-all" }`,
  "lib.mjs": `console.log("OUT lib.mjs runs");
export const v = "real";`,
  "user.mjs": `import { v } from "./lib.mjs";
console.log("OUT user.mjs runs");
export const read = () => v;`,
  "lib.cjs": `console.log("OUT lib.cjs runs");
exports.v = "real";`,
  "user.cjs": `const { v } = require("./lib.cjs");
console.log("OUT user.cjs runs");
exports.read = () => v;`,

  "importer.test.mjs": `${head}test("an importer", async () => {
  mock.module("./lib.mjs", () => ({ v: "mock" }));
  Bun.plugin.clearAll();
  console.log("OUT", (await import("./user.mjs")).read());
});`,
  "itself.test.mjs": `${head}test("the module itself", async () => {
  mock.module("./lib.mjs", () => ({ v: "mock" }));
  Bun.plugin.clearAll();
  console.log("OUT", (await import("./lib.mjs")).v);
});`,
  "required.test.mjs": `${head}test("a CommonJS file", async () => {
  mock.module("./lib.cjs", () => ({ v: "mock" }));
  Bun.plugin.clearAll();
  console.log("OUT", (await import("./user.cjs")).read());
});`,
  "no-factory.test.mjs": `${head}test("a mock without a factory", async () => {
  jest.doMock("./lib.mjs");
  Bun.plugin.clearAll();
  console.log("OUT", (await import("./user.mjs")).read());
});`,
  "loaded-first.test.mjs": `${head}test("the mock was loaded before", async () => {
  mock.module("./lib.mjs", () => ({ v: "mock" }));
  console.log("OUT", (await import("./user.mjs")).read());
  Bun.plugin.clearAll();
  console.log("OUT", (await import("./user.mjs")).read(), (await import("./lib.mjs")).v);
});`,
  "mocked-again.test.mjs": `${head}test("mocked again", async () => {
  mock.module("./lib.mjs", () => ({ v: "first" }));
  Bun.plugin.clearAll();
  mock.module("./lib.mjs", () => ({ v: "second" }));
  console.log("OUT", (await import("./user.mjs")).read());
});`,
};

async function run(dir: string, file: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./" + file],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

const pins = {
  "importer.test.mjs": ["OUT lib.mjs runs", "OUT user.mjs runs", "OUT real"],
  "itself.test.mjs": ["OUT lib.mjs runs", "OUT real"],
  "required.test.mjs": ["OUT lib.cjs runs", "OUT user.cjs runs", "OUT real"],
  "no-factory.test.mjs": ["OUT lib.mjs runs", "OUT user.mjs runs", "OUT real"],
  "loaded-first.test.mjs": ["OUT user.mjs runs", "OUT mock", "OUT mock mock"],
  "mocked-again.test.mjs": ["OUT user.mjs runs", "OUT second"],
};

test.concurrent.each(Object.keys(pins) as (keyof typeof pins)[])(
  "%s",
  async file => {
    using folder = tempDir("aot-mock-clear-all", files);
    const dir = String(folder);
    const plain = await run(dir, file, []);
    expect(plain).toEqual({ lines: pins[file], exitCode: 0 });
    expect(await run(dir, file, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
