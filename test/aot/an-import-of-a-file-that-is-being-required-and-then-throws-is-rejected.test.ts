import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";

const nameOfExecutable = isWindows ? "executable.exe" : "executable";

// file.cjs is being require()d. While it runs, something calls import("./file.cjs"). Then it throws. The throw takes the file out of
// require.cache and the loader of ES modules has not come to it yet, so `bun run` runs it again for the import(), which is rejected.
// Where Bun reads the text of an imported file itself and not on another thread, the loader has the file inside the call, and the import() is fulfilled.
const ask = (who: string) =>
  `import("./file.cjs").then(() => console.log("${who}: imported file.cjs"), error => console.log("${who}: file.cjs is rejected,", error.message));`;
const file = (call: string) => `if (globalThis.hasRun) throw new RangeError("thrown by the file");
globalThis.hasRun = true;
console.log("file begins");
exports.value = 1;
${call}
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

const whoCallsImport: Record<string, Record<string, string>> = {
  "the file itself": { "file.cjs": file(ask("file.cjs")) },
  "the file itself, in a function": { "file.cjs": file(`(function () { ${ask("file.cjs")} })();`) },
  "the file itself, in a method": { "file.cjs": file(`new (class { load() { ${ask("file.cjs")} } })().load();`) },
  "a CommonJS file that it requires": {
    "file.cjs": file(`require("./asks.cjs");`),
    "asks.cjs": `module.exports = {}; ${ask("asks.cjs")} console.log("asks.cjs ends");`,
  },
  // The loader takes the steps of the import() at once, and has the file when it throws.
  "an ES module that it requires": {
    "file.cjs": file(`require("./asks.mjs");`),
    "asks.mjs": `${ask("asks.mjs")} console.log("asks.mjs ends"); export {};`,
  },
  "a function of an earlier file": {
    "file.cjs": file(`globalThis.ask();`),
    "before": `globalThis.ask = () => { ${ask("earlier")} };\n`,
  },
};
const forms = Object.entries(whoCallsImport).flatMap(([who, files]) =>
  ["mjs", "cjs"].flatMap(extension =>
    [
      ["on another thread", "0"],
      ["by the thread that asks", "1"],
    ].map(([reader, disablesAsyncTranspiler]) => [who, extension, reader, disablesAsyncTranspiler, files] as const),
  ),
);

test.concurrent.each(forms)(
  "import() is called by %s, require() by a .%s file, texts are read %s",
  async (_, extension, __, disablesAsyncTranspiler, files) => {
    const { before = "", ...others } = files;
    const entry = `main.${extension}`;
    using dir = tempDir("aot-import-of-a-file-being-required", {
      ...others,
      [entry]: before + asker + (extension === "mjs" ? "export {};\n" : ""),
    });
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
