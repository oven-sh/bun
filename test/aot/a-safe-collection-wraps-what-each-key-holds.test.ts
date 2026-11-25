import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The library's SafeSet and SafeMap copy the methods of Set.prototype and Map.prototype when they are first loaded. A test may have replaced one before that.
async function take(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "./iterators.test.js"],
    directory,
    bunEnv,
  );
  if (exitCode !== 0) console.error(stderr);
  expect(exitCode).toBe(0);
  return stdout.split("\n").filter(line => /^(for of|keys\(\)|values\(\)): /.test(line));
}

test("a safe collection steps through the function that each key held, compiled as plain", async () => {
  using dir = tempDir("what-a-safe-collection-wraps", {
    "iterators.test.js": await Bun.file(
      join(import.meta.dir, "what-a-safe-collection-wraps", "iterators.fixture.js"),
    ).text(),
  });
  const plain = await take(String(dir));
  expect(plain).toEqual([
    "for of: Set.prototype[Symbol.iterator]",
    "keys(): Set.prototype.keys",
    "values(): Set.prototype.values",
  ]);
  expect(await take(String(dir), "--aot")).toEqual(plain);
});
