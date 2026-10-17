import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

const constantCount = isDebug || isASAN ? 4_000 : 60_000;
const timeout = isDebug || isASAN ? 240_000 : 20_000;

test(
  "build time is linear in the number of object literals held by constants of one module",
  async () => {
    const lines = Array.from(
      { length: constantCount },
      (_, index) =>
        `export const c${index} = { p: ${index} };\nexport function f${index}(): number { return c${index}.p; }`,
    );
    using dir = tempDir("aot-many-constants", { "main.ts": lines.join("\n") + "\n" });
    await using checked = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "./main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      checked.stdout.text(),
      checked.stderr.text(),
      checked.exited,
    ]);
    expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  },
  timeout,
);
