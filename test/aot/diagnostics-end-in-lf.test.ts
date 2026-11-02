import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// All that Bun prints ends its lines in LF, on Windows too. The "[aot] .." lines go through the C runtime, whose descriptor 2 is
// in text mode there: they ended in CR LF, and a pattern such as /^\[aot\] (.*)$/ on a line split at "\n" matched none of them.
test("what --aot writes to stderr ends its lines as the rest of Bun does", async () => {
  using dir = tempDir("aot-line-ends", { "main.js": `console.error("from the program");` });
  const { stderr, exitCode } = await run([bunExe(), "run", "--debug-aot", "main.js"], String(dir), {
    ...bunEnv,
    BUN_AOT_VERBOSE: "1",
  });
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("from the program\n");
  expect(stderr).not.toContain("\r");
  expect(exitCode).toBe(0);
}, 120_000);

test("a file that the compiler writes ends its lines in LF", async () => {
  using dir = tempDir("aot-line-ends-in-files", { "main.js": `console.log("ran");` });
  const map = join(String(dir), "main.map");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--debug-aot", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_aotMapFilePath: map },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await proc.exited).toBe(0);
  const text = readFileSync(map, "utf8");
  expect(text.split("\n").length).toBeGreaterThan(10);
  expect(text).not.toContain("\r");
}, 120_000);
