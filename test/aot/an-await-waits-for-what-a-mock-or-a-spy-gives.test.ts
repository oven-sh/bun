import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const fixtures = join(import.meta.dir, "an-await-waits-for-what-a-mock-or-a-spy-gives");

// The compiler expects the async function that is written. A mock or a spy in its place gives a promise of its own, and the `await` waits for that one too.
test("every test passes as in plain bun test", async () => {
  using dir = tempDir("aot-an-await-waits-for-what-a-mock-or-a-spy-gives", {
    "package.json": `{ "name": "awaits-and-mocks", "type": "module" }`,
    "keeper.ts": readFileSync(join(fixtures, "keeper.ts"), "utf8"),
    "awaits.test.ts": readFileSync(join(fixtures, "awaits.fixture.ts"), "utf8"),
  });
  const seenWith = async (...flags: string[]) => {
    const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    const named = (mark: RegExp) =>
      stderr
        .split("\n")
        .filter(line => mark.test(line))
        .map(line => line.replace(/\s*\[[^\]]*\]\s*$/, ""));
    return { passed: named(/^\(pass\)|^✓/), failed: named(/^\(fail\)|^✗|^panic/), exitCode };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain.failed).toEqual([]);
  expect(plain.passed.length).toBe(5);
  expect(plain.exitCode).toBe(0);
  expect(compiled).toEqual(plain);
}, 120_000);
