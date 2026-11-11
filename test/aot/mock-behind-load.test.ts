import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// One realm. b.test.js loads a module, c.test.js mocks it behind that load, d.test.js reads it again. `bun test` takes the hoisted mock as ahead of the load, as it is
// where c.test.js runs alone: c sees the names of the mock alone, the module of b waits aside, and its body does not run again for d. A compiled module stays loaded
// for the next test file, so `bun test --aot` lays the mock over it, and it keeps its names. Where each test file is a part of its own over the layer below, the body
// runs a second time for d.
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
      "SEEN c flag mock behind the real one mock behind the real one",
      "SEEN d default,flag,plain real real real",
    ],
    exitCode: 0,
  });
  expect(parts.seen.slice(0, 2)).toEqual(plain.seen.slice(0, 2));
  expect(parts.exitCode).toBe(0);
});

test("the mock behind the load is laid over the module, and the file behind it is as plain Bun", async () => {
  const [plain, parts] = await both();
  const laidOver = (line: string) => line.replace("SEEN c flag ", "SEEN c default,flag,plain ");
  expect(parts).toEqual({ ...plain, seen: plain.seen.map(laidOver) });
});
