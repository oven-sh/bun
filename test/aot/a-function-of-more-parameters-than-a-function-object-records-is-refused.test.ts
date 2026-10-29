// A function object records in 16 bits how many parameters its function declares. A function of 65,535 parameters that is handed on as a value builds and answers
// as in plain Bun. With one more the build ends with an error that names the limit and where the function stands.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "./supported";

const program = (count: number) =>
  `function many(${Array.from({ length: count }, (_, index) => `p${index}`).join(", ")}) {\n  return 1;\n}\n` +
  `globalThis.kept = many;\nconsole.log(globalThis.kept.length, globalThis.kept());\n`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("compile/aot/parameters of a function that is handed on", () => {
  test.concurrent(
    "65,535 build and answer",
    async () => {
      using dir = tempDir("aot-parameters-that-fit", { "main.js": program(65535) });
      const build = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"], String(dir));
      expect(build.stderr).not.toContain("error");
      expect(build.exitCode).toBe(0);
      expect(await run([join(String(dir), "main")], String(dir))).toEqual({
        stdout: "65535 1\n",
        stderr: "",
        exitCode: 0,
      });
    },
    240_000,
  );
  test.concurrent(
    "65,536 are refused",
    async () => {
      using dir = tempDir("aot-parameters-that-do-not-fit", { "main.js": program(65536) });
      const build = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"], String(dir));
      expect(build.stderr).not.toContain("internal compiler error");
      expect(build.stderr).toContain("main.js:1:1");
      expect(build.stderr).toContain("MaxReservedStackArguments");
      expect(build.exitCode).toBe(1);
    },
    240_000,
  );
});
