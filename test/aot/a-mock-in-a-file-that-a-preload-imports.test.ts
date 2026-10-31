// A compiled test run reads what its test files and preloads mock and spy on before it builds, and opens that alone. A preload is named as it was written,
// `--preload ./test/preload.ts`, and what it imports was looked for from "./test", which is no folder to the resolver: a mock in a file that the preload imports
// was seen by nobody. Over several programs the one that holds the module was then built closed:
// "mock(module, fn) cannot replace a module that was compiled ahead of time". A run whose layers open every module for another reason hides that, so the
// scan's own count is read as well.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/told/package.json": `{ "name": "told", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/told/index.js": `export const told = "real";`,
  "test/preload.ts": `import "./guardian";`,
  "test/guardian.ts": `
    import { mock } from "bun:test";
    class Fake { static kind = "fake"; }
    mock.module("ws", () => ({ default: Fake, WebSocket: Fake }));
    mock.module("told", () => ({ told: "mocked" }));
    mock.module("../src/own", () => ({ own: "mocked" }));`,
  "src/own.ts": `export const own = "real";`,
  "src/socket.ts": `
    import WebSocket from "ws";
    import { told } from "told";
    import { own } from "./own";
    export function seen(): string[] { return [(WebSocket as any).kind ?? typeof WebSocket, told, own]; }`,
  "test/one.test.ts": `
    import { test } from "bun:test";
    import { seen } from "../src/socket";
    test("t", () => { console.log("SEEN", JSON.stringify(seen())); });`,
};

const forms = { "one program": "TestRunLayers:0", "two layers": "TestRunLayers:2,TestRunPartFiles:1" };

for (const [title, words] of Object.entries(forms)) {
  test(`a module of Bun, a package and a file, mocked in a file that the preload imports: ${title}`, async () => {
    using dir = tempDir("a-mock-in-a-file-that-a-preload-imports", files);
    const lines = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
      const cmd = [bunExe(), "test", ...flags, "--preload", "./test/preload.ts"];
      const { stdout, stderr, exitCode } = await run(cmd, String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return {
        seen: stdout.split("\n").filter(line => line.startsWith("SEEN")),
        // The first scan is that of the test files and the preloads.
        scan: stderr.split("\n").find(line => line.startsWith("AOT test run | scan of ")) ?? "",
      };
    };
    const [plain, compiled] = [await lines(), await lines("--aot")];
    expect(plain.seen).toEqual([`SEEN ["fake","mocked","mocked"]`]);
    expect(compiled.seen).toEqual(plain.seen);
    // The scan is handed test/preload.ts, finds test/guardian.ts beside it, and there the three modules that are mocked.
    expect(Number(/ \| modules (\d+) \| /.exec(compiled.scan)?.[1])).toBeGreaterThanOrEqual(3);
  });
}
