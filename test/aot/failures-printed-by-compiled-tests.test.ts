// `bun test --aot` reports a failing test as `bun test` does: the message, the code frame, the frames with their lines and columns,
// and the summary. The files of ./failures-printed fail in the ways that tests fail: expectations, thrown values, rejections, hooks,
// timeouts, snapshots, and errors while a file loads.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const fixtures = join(import.meta.dir, "failures-printed");
const files = readdirSync(fixtures)
  .filter(name => name.endsWith(".fixture.ts"))
  .sort()
  .map(name => "./" + name);

const withoutTimes = (said: string) =>
  said
    .replace(/ \[\d+(\.\d+)?m?s\]/g, "")
    .replace(/after \d+(\.\d+)?ms/g, "after some time")
    // A build with assertions records positions inside built-in functions, so plain Bun gives `map (17:41)` there and `map (1:11)` in a release build. A compiled run gives `map (1:11)` in both.
    .replace(/^(\s+at \S+ )\((?:native:)?\d+:\d+\)$/gm, "$1(built-in)")
    .replaceAll("\r\n", "\n");

test("a failing test is reported as in a plain run", async () => {
  using dir = tempDir("failures-printed-by-compiled-tests", fixtures);
  writeFileSync(
    join(String(dir), "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "Preserve",
        noEmit: true,
        typeRoots: [join(import.meta.dir, "..", "..", "packages")],
        types: ["bun-types"],
      },
    }),
  );
  const env = { ...bunEnv, CI: "1", NO_COLOR: "1" };
  const plain = await run([bunExe(), "test", ...files], String(dir), env);
  const compiled = await run([bunExe(), "test", "--aot", ...files], String(dir), env);
  expect(withoutTimes(plain.stderr)).toContain("(fail) a deep expectation");
  expect(withoutTimes(compiled.stderr)).toBe(withoutTimes(plain.stderr));
  expect(compiled.stdout).toBe(plain.stdout);
  expect(compiled.exitCode).toBe(plain.exitCode);
});
