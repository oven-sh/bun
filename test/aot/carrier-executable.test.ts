import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as spawn } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.ts": "const answer: number = 40 + 2;\nconsole.log(answer);\n",
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [] },
  }),
  "not-a-bun": "#!/bin/sh\necho no\n",
};

function build(cwd: string, carrier: string) {
  return spawn(
    [bunExe(), "build", "--compile", "--aot", "--compile-executable-path", carrier, "--outfile", "out", "main.ts"],
    cwd,
  );
}

test("builds with its own executable as the carrier", async () => {
  using dir = tempDir("aot-carrier-own", files);
  const built = await build(String(dir), bunExe());
  expect(built.stderr).not.toContain("error");
  expect(built.exitCode).toBe(0);
  const ran = await spawn([join(String(dir), "out")], String(dir));
  expect(ran.stdout).toBe("42\n");
  expect(ran.exitCode).toBe(0);
});

test("builds with a symlink to its own executable as the carrier", async () => {
  using dir = tempDir("aot-carrier-symlink", files);
  const link = join(String(dir), "link-to-bun.exe");
  symlinkSync(bunExe(), link);
  const built = await build(String(dir), link);
  expect(built.stderr).not.toContain("error");
  expect(built.exitCode).toBe(0);
  const ran = await spawn([join(String(dir), "out")], String(dir));
  expect(ran.stdout).toBe("42\n");
  expect(ran.exitCode).toBe(0);
});

test("refuses a carrier that is not a Bun", async () => {
  using dir = tempDir("aot-carrier-not-a-bun", files);
  const carrier = join(String(dir), "not-a-bun");
  chmodSync(carrier, 0o755);
  const built = await build(String(dir), carrier);
  expect(built.stderr).toContain("can't run code compiled by this Bun");
  expect(built.exitCode).toBe(1);
});
