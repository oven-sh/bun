// `bun test` turns the imports of a Vitest test file into `await import()`, and a call of an imported function into
// `(0, module.name)(..)`, which passes no `this`. `bun test --aot` writes the same into its own tree. The checker took
// that comma for the user's (TS2695), and a file with a type error is compiled without its types.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "a.test.ts": `import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { expect, it } from "vitest";
const here = basename(fileURLToPath(import.meta.url));
it("a", () => { expect(here).toBe("a.test.ts"); });
`,
};

test("a call of an imported function is no type error", async () => {
  using dir = tempDir("lowered-imports-keep-their-types", files);
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", "./a.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  expect(stderr.split("\n").filter(line => /^(warn|error): TS\d+/.test(line))).toEqual([]);
  expect(stderr).toContain("(pass) a");
  expect(exitCode).toBe(0);
});
