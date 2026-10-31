// A compiled test run reads what its test files and the helpers beside them mock and spy on before it builds. It looked for a helper under a relative name alone:
// one that a test file imports as "@/test/helpers/guard", a name that tsconfig.json gives to the file, was read by nobody, and neither were the names that go to
// it. Over several programs the one that holds a module that such a helper mocks was built closed:
// "mock(module, fn) cannot replace a module that was compiled ahead of time".
// The same for a helper's function that goes on into a parameter, and for the files of a folder that a test file names and loads one by one.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
  "src/own.ts": `export const own = "real";`,
  "src/math.ts": `
    export function twice(n: number) { return n * 2; }
    export function thrice(n: number) { return n * 3; }
    export function half(n: number) { return n / 2; }`,
  "src/user.ts": `
    import { own } from "./own";
    import { half, thrice, twice } from "./math";
    export function all(): unknown[] { return [own, twice(2), thrice(2), half(2)]; }`,
  "test/helpers/guard.ts": `
    import { mock } from "bun:test";
    mock.module("../../src/own", () => ({ own: "mocked" }));`,
  "test/helpers/tracker.ts": `
    import { spyOn } from "bun:test";
    export function createTracker() {
      return { watch(object: any, name: string) { return spyOn(object, name); } };
    }`,
  "test/rows/one.rows.ts": `
    import { spyOn } from "bun:test";
    import * as math from "../../src/math";
    export function row() { spyOn(math, "half").mockReturnValue(-3); }`,
  "test/one.test.ts": `
    import { test } from "bun:test";
    import { Glob } from "bun";
    import { fileURLToPath } from "url";
    import "@/test/helpers/guard";
    import { createTracker } from "@/test/helpers/tracker";
    import * as math from "../src/math";
    const folder = fileURLToPath(new URL("./rows/", import.meta.url));
    const tracker = createTracker();
    function start(watch: ReturnType<typeof createTracker>["watch"]) { watch(math, "thrice").mockReturnValue(-2); }
    test("t", async () => {
      tracker.watch(math, "twice").mockReturnValue(-1);
      start(tracker.watch);
      for (const name of new Glob("*.rows.ts").scanSync(folder)) (await import(folder + name)).row();
      const { all } = await import("../src/user");
      console.log("SEEN", JSON.stringify(all()));
    });`,
};

const forms = { "one program": "TestRunLayers:0", "two layers": "TestRunLayers:2,TestRunPartFiles:1" };

for (const [title, words] of Object.entries(forms)) {
  test(`a helper under a name of the tsconfig, its function in a parameter, the files of a folder: ${title}`, async () => {
    using dir = tempDir("helpers-that-a-test-file-reaches-by-other-ways", files);
    const lines = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const log = stderr.split("\n");
      return {
        seen: stdout.split("\n").filter(line => line.startsWith("SEEN")),
        // The first scan is that of the test files.
        scan: log.find(line => line.startsWith("AOT test run | scan of ")) ?? "",
        texts:
          log.find(line => line.includes("spies on an object from somewhere under a name that it does not spell")) ??
          "",
      };
    };
    const [plain, compiled] = [await lines(), await lines("--aot")];
    expect(plain.seen).toEqual([`SEEN ["mocked",-1,-2,-3]`]);
    expect(compiled.seen).toEqual(plain.seen);
    // src/own.ts, which test/helpers/guard.ts mocks, and `half` of src/math.ts, which test/rows/one.rows.ts spies on.
    expect(Number(/ \| exports (\d+) \| /.exec(compiled.scan)?.[1])).toBeGreaterThanOrEqual(1);
    expect(Number(/ \| modules (\d+) \| /.exec(compiled.scan)?.[1])).toBeGreaterThanOrEqual(1);
    // "twice" and "thrice"
    expect(compiled.texts).toEndWith(": 2 texts are passed to it");
  });
}
