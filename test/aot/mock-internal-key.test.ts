import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The module that `bun test` writes for a mock whose factory takes the original names its imports by a key of the loader, behind a NUL.
// No program may: an import() of such a name is refused, also in a file that has such a mock of its own.
const attempts = `
async function attempts() {
  for (const specifier of ["\\0bun:module-mock", "\\0\\0bun:module-mock", "\\0node:fs", "\\0/etc/hostname"]) {
    const row = [];
    for (const load of [() => import(specifier), () => vi.importActual(specifier), () => vi.importMock(specifier), () => require(specifier)]) {
      try {
        row.push("loaded " + Object.keys(await load()).length);
      } catch (error) {
        row.push(error.constructor.name);
      }
    }
    console.error("SEEN", JSON.stringify(specifier), row.join(" | "));
  }
}`;
const files = {
  "package.json": `{ "name": "mock-internal-key" }`,
  "mocked.ts": `import { vi } from "bun:test"; export ${attempts.trim()}`,
  "itself.test.ts": `
import { test, vi } from "bun:test";
${attempts}
test("a test file that mocks itself", async () => {
  vi.doMock(import.meta.path, async importOriginal => ({ a: 1 }));
  await attempts();
});`,
  "original.test.ts": `
import { test, vi } from "bun:test";
test("the original of a module that is mocked", async () => {
  vi.doMock("./mocked.ts", async importOriginal => ({ ...(await importOriginal()) }));
  await (await import("./mocked.ts")).attempts();
});`,
};

test.each(["itself.test.ts", "original.test.ts"])("%s", async name => {
  using dir = tempDir("mock-internal-key", files);
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./" + name], String(dir), {
      ...bunEnv,
      ...env,
    });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith({}),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot"),
  ]);
  expect(plain.seen.length).toBe(4);
  expect(plain.seen.join("\n")).not.toContain("loaded");
  expect(plain.exitCode).toBe(0);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
});
