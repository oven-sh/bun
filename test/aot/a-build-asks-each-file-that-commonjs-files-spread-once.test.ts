import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

async function run(cmd: string[], cwd: string) {
  await using process = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited]);
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
}

const executable = (dir: string) => join(dir, isWindows ? "compiled.exe" : "compiled");

// Each level spreads two files that spread the next level, so there are 2^40 ways from the first file to the last.
test("a build asks each file that CommonJS files spread once", async () => {
  const levels = 40;
  const files: Record<string, string> = {
    "main.cjs": `const all = require("./level0.cjs");\nconsole.log(all.call(), all.call(1));\n`,
    [`level${levels}.cjs`]: `exports.call = function (a) { return a ?? 0; };\n`,
  };
  for (let level = 0; level < levels; level++) {
    files[`level${level}.cjs`] =
      `module.exports = { ...require("./left${level}.cjs"), ...require("./right${level}.cjs") };\n`;
    for (const side of ["left", "right"])
      files[`${side}${level}.cjs`] =
        `module.exports = { ...require("./level${level + 1}.cjs"), ${side}${level}: 1 };\n`;
  }
  using dir = tempDir("aot-spreads-of-spreads", files);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable(String(dir))],
    String(dir),
  );
  expect(built.errors).toEqual([]);
  expect((await run([executable(String(dir))], String(dir))).stdout).toBe("0 1\n");
  expect(built.exitCode).toBe(0);
});
