import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
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
    const { stdout, exitCode } = await run([bunExe(), "check", ...flags, "--pretty", "false", "a.ts"], String(dir));
    expect(stdout).not.toContain("the script ran");
    expect(stdout).toContain("a.ts(1,14): error TS2322");
    expect(exitCode).toBe(1);
  },
);

test("bun check without these flags still runs the script", async () => {
  using dir = tempDir("aot-check-script", {
    "package.json": JSON.stringify({ scripts: { check: "echo the script ran" } }),
  });
  const { stdout, exitCode } = await run([bunExe(), "check"], String(dir));
  expect(stdout).toContain("the script ran");
  expect(exitCode).toBe(0);
});
