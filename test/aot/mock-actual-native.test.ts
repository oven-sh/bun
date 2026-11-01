// node:util/types, node:buffer and a few more built-in modules are made by native code: the library holds no source of them. jest.requireActual() of one, in a file
// with ES syntax, ended a compiled run that was built as one program with "The module loader was not compiled into this executable".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-actual-native" }`,
  "named.test.mjs": `import { jest, test } from "bun:test";
test("by name", () => {
  const types = jest.requireActual("node:util/types");
  console.log("OUT", types === require("node:util/types"), types.isDate(new Date()), typeof jest.requireActual("util/types").isRegExp);
  console.log(
    "OUT",
    typeof jest.requireActual("node:buffer").Buffer,
    typeof jest.requireActual("node:process").cwd,
    typeof jest.requireActual("node:string_decoder").StringDecoder,
    typeof jest.requireActual("node:constants").O_RDONLY,
    typeof jest.requireActual("node:module").createRequire,
    typeof jest.requireActual("bun:jsc").heapStats,
  );
});`,
  "mocked.test.mjs": `import { jest, test } from "bun:test";
jest.mock("node:util/types", () => ({ ...jest.requireActual("node:util/types"), isDate: () => "mine" }));
test("under a mock of it", () => {
  const types = require("node:util/types");
  console.log("OUT", types.isDate(1), typeof types.isRegExp, jest.requireActual("node:util/types").isDate(1));
});`,
  "global.test.ts": `test("the global jest in a TypeScript file", () => {
  console.log("OUT", typeof jest.requireActual("node:util/types").isDate);
});`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("answers with the module, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-actual-native", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: [
      "OUT function",
      "OUT mine function false",
      "OUT true true function",
      "OUT function function function number function function",
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
