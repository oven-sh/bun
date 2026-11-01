// `bun test` hands a file the runner's names out of "vitest" where a test file that imports "vitest" loads it first, and out of "bun:test" otherwise.
// Both have `beforeEach`, `afterEach`, `beforeAll` and `it`, and theirs behave differently. A helper that uses them as globals gets the same ones compiled.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const helper = `export function shared(log: string[]) {
  beforeAll(() => () => { log.push("what beforeAll returned ran"); });
  afterEach(() => { log.push("after each, first laid"); });
  afterEach(() => { log.push("after each, second laid"); });
  it("is handed", (handed: unknown) => { log.push("handed a " + typeof handed); if (typeof handed === "function") handed(); });
}
export function layHookInsideTest(log: string[]) {
  try { beforeEach(() => { log.push("before each"); }); log.push("taken"); } catch { log.push("refused"); }
}
`;
const testFile = (runner: string) => `import { afterAll, describe, it } from "${runner}";
import { layHookInsideTest, shared } from "./helper";
const log: string[] = [];
describe("shared tests of a helper that uses the globals", () => { shared(log); });
it("lays a hook inside a test", () => { layHookInsideTest(log); });
afterAll(() => { console.log("SEEN " + JSON.stringify(log)); });
`;

const forms: [string, string, string[]][] = [
  ["as the run is built by itself", "", []],
  ["one program", "TestRunLayers:0", []],
  ["three layers", "TestRunLayers:3", ["--isolate"]],
];

async function seen(runner: string, words: string, flags: string[]) {
  using dir = tempDir("helper-flavor", {
    "package.json": `{ "name": "helper-flavor", "type": "module" }`,
    "helper.ts": helper,
    "shared.test.ts": testFile(runner),
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  const counts = stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)).map(line => line.trim()); // prettier-ignore
  return { seen: (stdout + "\n" + stderr).split("\n").find(line => line.startsWith("SEEN ")), counts };
}

for (const runner of ["vitest", "bun:test"]) {
  for (const [form, words, flags] of forms) {
    test.concurrent(`below a test file that imports "${runner}", ${form}`, async () => {
      const [plain, compiled] = await Promise.all([seen(runner, "", []), seen(runner, words, ["--aot", ...flags])]);
      expect(plain.seen).toBeDefined();
      expect(compiled).toEqual(plain);
    });
  }
}
