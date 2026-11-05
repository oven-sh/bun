// `createRequire("/")("./part.cjs")`: Node looks for /part.cjs. `bun run` looks in the working directory, because the folder of "/noop.js", the file that
// such a require looks from, comes out as "./". An executable carries its files and has no working directory that stands for them: it throws
// MODULE_NOT_FOUND, with --aot as without (docs/compiler/compatibility.mdx). It used to answer with the file of that name beside the entry point, which is
// what a program got that went two folders up from its own: `createRequire(dirname(dirname(__dirname)) + "/")`.
// A require made for a file in the root, `createRequire("/start.cjs")`, is the same but for the file that it looks from.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const loads: Record<string, string> = {
  "the root": `createRequire(pick("/"))(pick("./part.cjs")).said`,
  "the root, doubled": `createRequire(pick("//"))(pick("./part.cjs")).said`,
  "the root, a folder below": `createRequire(pick("/"))(pick("./inner/part.cjs")).said`,
  "the root, resolve": `createRequire(pick("/")).resolve(pick("./part.cjs"))`,
  "the root, written": `createRequire("/")("./part.cjs").said`,
  "the root as a URL": `createRequire(new URL("file:///"))("./part.cjs").said`,
  "a file in the root": `createRequire(pick("/start.cjs"))(pick("./part.cjs")).said`,
  "a file in the root, a folder below": `createRequire(pick("/start.cjs"))(pick("./inner/part.cjs")).said`,
  "a file in the root, resolve": `createRequire(pick("/start.cjs")).resolve(pick("./part.cjs"))`,
  "a file in the root, written": `createRequire("/start.cjs")("./part.cjs").said`,
  "a file in the root as a URL": `createRequire(new URL("file:///start.cjs"))("./part.cjs").said`,
};

test.skipIf(isWindows)(
  "a require made for the root of the file system finds no file of the executable",
  async () => {
    using dir = tempDir("aot-the-root-of-the-file-system", {
      "app/main.mjs":
        `import { createRequire } from "node:module";\nimport "./part.cjs";\nimport "./inner/part.cjs";\nconst pick = text => (process.argv.length > 9 ? process.argv[9] : text);\n` +
        Object.entries(loads)
          .map(
            ([way, load]) =>
              `try { console.log(${JSON.stringify(way)} + ": " + ${load}); } catch (error) { console.log(${JSON.stringify(way)} + ": " + error.code); }\n`,
          )
          .join(""),
      "app/part.cjs": `exports.said = "beside the entry point";\n`,
      "app/inner/part.cjs": `exports.said = "below the entry point";\n`,
      "away/empty.txt": "",
    });
    const app = join(String(dir), "app");
    const away = join(String(dir), "away");
    const refused = Object.keys(loads).map(way => `${way}: MODULE_NOT_FOUND`);
    for (const flags of [["--aot"], []]) {
      const executable = join(away, "main");
      const built = await run(
        [bunExe(), "build", "--compile", ...flags, "main.mjs", "--outfile", executable],
        app,
        bunEnv,
      );
      expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({
        exitCode: 0,
        stderr: "",
      });
      expect((await run([executable], away, bunEnv)).stdout.trim().split("\n")).toEqual(refused);
    }
  },
  120_000,
);
