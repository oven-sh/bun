import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

const few = isDebug || isASAN ? 1_000 : 15_000;
const many = 4 * few;

async function processorSecondsOfCheck(constantCount: number) {
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
  const [stdout, stderr, exitCode] = await Promise.all([checked.stdout.text(), checked.stderr.text(), checked.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  return Number(checked.resourceUsage()!.cpuTime.user) / 1e6;
}

// Four times the constants take four times as long where the time is linear, and sixteen times as long where it is quadratic.
test("build time is linear in the number of object literals held by constants of one module", async () => {
  const withFew = await processorSecondsOfCheck(few);
  const withMany = await processorSecondsOfCheck(many);
  expect(withMany / withFew).toBeLessThan(8);
}, 240_000);
