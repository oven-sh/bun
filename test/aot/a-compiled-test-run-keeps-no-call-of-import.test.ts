import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Where test files share their modules, `bun test` keeps a note of each import(), to find who holds a mock when the mock ends. An import() in compiled code
// comes without the module that calls, and the loader holds no compiled module to take out. So a compiled run keeps no call, and ends its mocks as it did.
const files = {
  "package.json": `{ "name": "calls-of-import" }`,
  "flags.ts": `export const enabled = "real";`,
  "lazy.ts": `
    import { vi } from "bun:test";
    let flags;
    export const read = async () => (flags ??= await vi.importMock("./flags")).enabled;`,
  "a.test.ts": `
    import { moduleCallsKeptForModuleMocks as kept } from "bun:internal-for-testing";
    import { test, vi } from "bun:test";
    import { read } from "./lazy";
    vi.mock("./flags", () => ({ enabled: "mock" }));
    test("a", async () => console.log("SEEN", await read(), kept() > 0 ? "keeps calls" : "keeps no call"));`,
  "b.test.ts": `
    import { test } from "bun:test";
    test("b", () => {});`,
};

async function seenWith(...more: string[]) {
  using dir = tempDir("calls-of-import", files);
  const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), bunEnv);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("a run of test files from their source keeps the calls, and a compiled run keeps none", async () => {
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain).toEqual({ seen: ["SEEN mock keeps calls"], exitCode: 0 });
  expect(compiled).toEqual({ seen: ["SEEN mock keeps no call"], exitCode: 0 });
});
