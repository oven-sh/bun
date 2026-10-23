import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

test.each(["--aot", "--explain=guards"])(
  "bun check %s is the type checker where package.json has a `check` script",
  async flag => {
    using dir = tempDir("aot-check-script", {
      "package.json": JSON.stringify({ scripts: { check: "echo the script ran" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }),
      "a.ts": `export const a: number = "1";\n`,
    });
    const flags = flag === "--aot" ? [flag] : ["--aot", flag];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", ...flags, "--pretty", "false", "a.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).not.toContain("the script ran");
    expect(stdout).toContain("a.ts(1,14): error TS2322");
    expect(exitCode).toBe(1);
  },
);

test("bun check without these flags still runs the script", async () => {
  using dir = tempDir("aot-check-script", {
    "package.json": JSON.stringify({ scripts: { check: "echo the script ran" } }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain("the script ran");
  expect(exitCode).toBe(0);
});
