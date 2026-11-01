import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const attempt = (name: string, path: string) => `test("${name}", async () => {
  try {
    await import("${path}");
  } catch (error) {
    console.log("OUT ${name}", String((error as Error).message).replace(/ from .*/, ""));
  }
});`;
const mocksState = `import { test, vi } from "bun:test";
vi.mock("./state", async importOriginal => ({ ...(await importOriginal<any>()), made: 1 }));`;
const readsKeys = (name: string) => `import { test } from "bun:test";
import { key } from "./keys";
test("${name}", () => console.log("OUT ${name}", key));`;

const shared = {
  "package.json": `{ "name": "mock-original-fails" }`,
  "keys.ts": `export const key = 1;`,
  "state.ts": `import { Base } from "not-installed/base"; import { key } from "./keys"; export class State extends Base { key = key; }`,
  "uses-state.ts": `import { State } from "./state"; import { key } from "./keys"; export const made = () => [State, key];`,
  "a-first.test.ts": readsKeys("first"),
  "b-resets.test.ts": `import { afterEach, test, vi } from "bun:test";
afterEach(() => { vi.resetModules(); });
test("resets", () => console.log("OUT resets"));`,
  "d-last.test.ts": readsKeys("last"),
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

const missing = "Cannot find package 'not-installed' imported";

test("the next test file runs", async () => {
  using folder = tempDir("aot-mock-original-fails", {
    ...shared,
    "c-mocks.test.ts": `${mocksState}\n${attempt("mocked", "./state")}\n${attempt("importer", "./uses-state")}`,
  });
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: ["OUT first 1", "OUT resets", `OUT mocked ${missing}`, `OUT importer ${missing}`, "OUT last 1"],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
