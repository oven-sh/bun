import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// One realm. b.test.js loads a module, c.test.js mocks it behind that load, d.test.js reads it again. `bun test` lays the mock over the loaded module: it keeps its names,
// and its body does not run again. Where each test file is a part of its own over the layer below, the mock is taken as ahead of the load: c sees the names of the mock
// alone, and the body runs a second time for d. As one program, and over two layers that hold all test files in one part, the run is as plain Bun's.
const real = (file: string) => `
import { test } from "bun:test";
import * as all from "./dep.js";
import { flag } from "./dep.js";
test("${file}", () => console.log("SEEN ${file}", Object.keys(all).join(), all.flag, flag, require("./dep.js").flag));`;
const files = {
  "package.json": `{ "name": "mock-behind-load" }`,
  "dep.js": `console.log("SEEN dep.js runs"); export const flag = "real"; export const plain = "real"; export default "real";`,
  "b.test.js": real("b"),
  "c.test.js": `
import { test, vi } from "bun:test";
import * as all from "./dep.js";
import { flag } from "./dep.js";
vi.mock("./dep.js", () => ({ flag: "mock behind the real one" }));
test("c", () => console.log("SEEN c", Object.keys(all).join(), all.flag, flag));`,
  "d.test.js": real("d"),
};

async function seenWith(words?: string, ...more: string[]) {
  using dir = tempDir("mock-behind-load", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}
let runs:
  Promise<[plain: Awaited<ReturnType<typeof seenWith>>, parts: Awaited<ReturnType<typeof seenWith>>]> | undefined;
const both = () => (runs ??= Promise.all([seenWith(), seenWith("TestRunLayers:0", "--aot")]));

test("up to the file that mocks, a part a file is as plain Bun", async () => {
  const [plain, parts] = await both();
  expect(plain).toEqual({
    seen: [
      "SEEN dep.js runs",
      "SEEN b default,flag,plain real real real",
      "SEEN c default,flag,plain mock behind the real one mock behind the real one",
      "SEEN d default,flag,plain real real real",
    ],
    exitCode: 0,
  });
  expect(parts.seen.slice(0, 2)).toEqual(plain.seen.slice(0, 2));
  expect(parts.exitCode).toBe(0);
});

test("the mock behind the load, and the file behind it, are as plain Bun", async () => {
  const [plain, parts] = await both();
  expect(parts).toEqual(plain);
});
