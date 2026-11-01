import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfFiles = 12;
const files: Record<string, string> = {
  "package.json": `{}`,
  "src/never.ts": `await new Promise(() => {});\nexport const never = 1;\n`,
  "src/other.ts": `export const other = 1;\n`,
  "zz-counts.test.ts": `
    import { heapStats } from "bun:jsc";
    import { test } from "bun:test";
    test("counts", async () => {
      let alive = 0;
      for (let round = 0; round < 20; round++) {
        Bun.gc(true);
        await new Promise(resolve => setTimeout(resolve, 1));
        alive = heapStats().objectTypeCounts.GlobalObject ?? 0;
        if (alive <= 3) break;
      }
      console.log("at most three realms are alive: " + (alive <= 3));
    });`,
};
for (let file = 0; file < numberOfFiles; file++) {
  files[`${String(file).padStart(2, "0")}.test.ts`] = `
    import { test } from "bun:test";
    void import("./src/never");
    void Promise.all([import("./src/never"), import("./src/other")]);
    test("passes", async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });`;
}

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return {
    stdout: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("at most three realms")),
    exitCode,
  };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`the realm of a test file that ends with an import() unsettled is let go, ${way}`, async () => {
    using dir = tempDir("aot-kept-realms", files);
    const plain = await runTests(String(dir), undefined, "--isolate");
    expect(plain).toEqual({ stdout: ["at most three realms are alive: true"], exitCode: 0 });
    expect(await runTests(String(dir), words, "--isolate", "--aot")).toEqual(plain);
  }, 180_000);
}

test("the same in two workers", async () => {
  using dir = tempDir("aot-kept-realms", files);
  const plain = await runTests(String(dir), undefined, "--parallel=2");
  expect(plain).toEqual({ stdout: ["at most three realms are alive: true"], exitCode: 0 });
  expect(await runTests(String(dir), undefined, "--parallel=2", "--aot")).toEqual(plain);
}, 180_000);
