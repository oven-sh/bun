import { expect, test } from "bun:test";
import { buildSync } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { bunEnv, bunExe, tempDir } from "../../../test/harness";
import { supportedPlatforms } from "../src/platform";

test("npm postinstall preserves the optional executable across repeated runs", async () => {
  using dir = tempDir("bun-npm-postinstall", {
    "package.json": JSON.stringify({ name: "bun", version: "0.0.0" }),
    "bin/bun.exe": "postinstall has not run",
    "bin/bunx.exe": "postinstall has not run",
  });
  const root = String(dir);
  const platform = supportedPlatforms[0];
  expect(platform).toBeDefined();
  const source = join(root, "node_modules", "@oven", platform.bin, platform.exe);
  mkdirSync(dirname(source), { recursive: true });
  copyFileSync(bunExe(), source);
  const original = readFileSync(source);
  const script = join(root, "install.cjs");
  buildSync({
    entryPoints: [join(import.meta.dir, "npm-postinstall.ts")],
    outfile: script,
    bundle: true,
    treeShaking: true,
    keepNames: true,
    minifySyntax: true,
    pure: ["console.debug"],
    platform: "node",
    target: "es6",
    format: "cjs",
    define: { version: '"0.0.0"', module: '"bun"', owner: '"@oven"' },
  });
  for (let run = 0; run < 3; run++) {
    const proc = Bun.spawn({ cmd: [bunExe(), script], cwd: root, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(readFileSync(source).toString("base64")).toBe(original.toString("base64"));
    expect(readFileSync(join(root, "bin/bun.exe")).toString("base64")).toBe(original.toString("base64"));
    expect(readFileSync(join(root, "bin/bunx.exe")).toString("base64")).toBe(original.toString("base64"));
  }
});
