import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";

const nameOfExecutable = isWindows ? "executable.exe" : "executable";

// file.cjs is being require()d. While it runs, something calls import("./file.cjs"). Then it throws. The throw takes the file out of
// require.cache and the loader of ES modules has not come to it yet, so `bun run` runs it again for the import(), which is rejected.
// Where Bun reads the text of an imported file itself and not on another thread, the loader has the file inside the call, and the import() is fulfilled.
const file = `if (globalThis.hasRun) throw new RangeError("thrown by the file in its second run");
globalThis.hasRun = true;
console.log("file begins");
exports.value = 1;
import("./file.cjs").then(() => console.log("file.cjs: imported file.cjs"), error => console.log("file.cjs: file.cjs is rejected,", error.message));
throw new RangeError("thrown by the file");
`;
const asker = `try {
  require("./file.cjs");
  console.log("required file.cjs");
} catch (error) {
  console.log("require of file.cjs threw,", error.message);
}
console.log("the asker ends");
`;

test.concurrent.each([
  ["on another thread", "0"],
  ["by the thread that asks", "1"],
])(
  "import() is called by the file itself, texts are read %s",
  async (_, disablesAsyncTranspiler) => {
    const entry = "main.mjs";
    using dir = tempDir("aot-import-of-a-file-being-required", { "file.cjs": file, [entry]: asker + "export {};\n" });
    const env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: disablesAsyncTranspiler };
    const run = async (cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const expected = await run([bunExe(), entry]);
    expect(expected.stdout).toContain("require of file.cjs threw, thrown by the file");
    const executable = join(String(dir), nameOfExecutable);
    const built = await run([bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable]);
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run([executable])).toEqual(expected);
  },
  600_000,
);
