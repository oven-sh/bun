// An ES module makes itself `__dirname` and a require for a folder above its own. In an executable the entry point lies two folders below the root of
// the file system, so two folders up is "/": path.join() gives "/", and a separator added behind it gives "//". One path has many spellings; the build
// holds what createRequire() is given against the path that it read, whichever spelling it comes in. The sources are gone when the executable runs.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const bases: Record<string, string> = {
  "join() two folders up and a separator": `join(__dirname, "..", "..") + "/"`,
  "resolve() two folders up and a separator": `resolve(__dirname, "../..") + "/"`,
  "join() two folders up and a file": `join(__dirname, "..", "..") + "/start.cjs"`,
  "join() two folders up with the file inside": `join(__dirname, "..", "..", "start.cjs")`,
  "a template two folders up": "`${__dirname}/../../`",
  "a sum two folders up": `__dirname + "/../../"`,
  "join() one folder up and a separator": `join(__dirname, "..") + "/"`,
  "a template one folder up": "`${__dirname}/../`",
  "a template into a sibling": "`${__dirname}/../vendor/`",
  "the own folder": "`${__dirname}/`",
};

test("a require made for a folder above the entry point finds the files of that folder", async () => {
  using dir = tempDir("aot-a-folder-above-the-entry-point", {
    "top/app/src/main.mjs":
      `import { createRequire } from "node:module";\nimport { fileURLToPath } from "node:url";\nimport { dirname, join, resolve } from "node:path";\n` +
      `const __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\n` +
      Object.entries(bases)
        .map(
          ([way, base]) =>
            `try { console.log(${JSON.stringify(way)} + ": " + createRequire(${base})("./part.cjs").said); } catch (error) { console.log(${JSON.stringify(way)} + ": " + error.code); }\n`,
        )
        .join(""),
    "top/app/src/part.cjs": `exports.said = "the own folder";\n`,
    "top/app/vendor/part.cjs": `exports.said = "a sibling";\n`,
    "top/app/part.cjs": `exports.said = "one folder up";\n`,
    "top/part.cjs": `exports.said = "two folders up";\n`,
    "away/empty.txt": "",
  });
  const source = join(String(dir), "top", "app", "src");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], source, bunEnv);
  expect(plain.stdout.split("\n").filter(line => line.endsWith("_FOUND"))).toEqual([]);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    source,
    bunEnv,
  );
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  renameSync(join(String(dir), "top"), join(String(dir), "moved-away"));
  expect((await run([executable], away, bunEnv)).stdout).toBe(plain.stdout);
}, 120_000);
