import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `--debug-aot` is for Bun's own tests: `bun run` and `bun test` compile the whole program ahead of time and run the compiled code.
async function ran(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
  return { stdout, stderr, exitCode };
}

test("bun run --debug-aot runs compiled code", async () => {
  using dir = tempDir("debug-aot-run", { "main.ts": `const n: number = 20; console.log("said", n + 1);` });
  const { stdout, stderr, exitCode } = await ran(String(dir), ["run", "--debug-aot", "main.ts"]);
  expect(stderr).toContain("[aot] module: ");
  expect({ stdout, exitCode }).toEqual({ stdout: "said 21\n", exitCode: 0 });
});

test("bun test --debug-aot runs compiled code", async () => {
  using dir = tempDir("debug-aot-test", {
    "one.test.ts": `import { expect, test } from "bun:test"; test("adds", () => { const n: number = 20; expect(n + 1).toBe(21); });`,
  });
  const { stderr, exitCode } = await ran(String(dir), ["test", "--debug-aot", "one.test.ts"]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test("--help does not mention it", async () => {
  using dir = tempDir("debug-aot-help", {});
  for (const args of [["run", "--help"], ["test", "--help"], ["--help"]]) {
    const { stdout, stderr } = await ran(String(dir), args);
    expect(stdout + stderr).not.toContain("debug-aot");
  }
});
