import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, tempDir } from "harness";

// All that Bun prints ends its lines in LF, on Windows too. The "[aot] .." lines go through the C runtime, whose descriptor 2 is
// in text mode there: they ended in CR LF, and a pattern such as /^\[aot\] (.*)$/ on a line split at "\n" matched none of them.
test("what --aot writes to stderr ends its lines as the rest of Bun does", async () => {
  using dir = tempDir("aot-line-ends", { "main.js": `console.error("from the program");` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--debug-aot", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("from the program\n");
  expect(stderr).not.toContain("\r");
  expect(exitCode).toBe(0);
}, 120_000);
