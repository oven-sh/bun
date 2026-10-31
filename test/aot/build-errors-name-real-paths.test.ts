import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// What the build refuses it names by file and line. The file has to be named as the system names it: on Windows
// "/C:/a/main.mjs:2" is how the type checker writes a path and nothing that can be opened.
test("an error of an --aot build names the file by a path that can be opened", async () => {
  using dir = tempDir("aot-build-error-paths", {
    "main.mjs": `console.log("first line");\nimport { a } from "./absent.mjs";\nconsole.log(a);\n`,
  });
  const outfile = join(String(dir), isWindows ? "program.exe" : "program");
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", outfile],
    String(dir),
  );
  expect(stderr).toContain('Could not resolve: "./absent.mjs"');
  const place = stderr.split(/\r?\n/).find(line => /^\s+at .*:2:\d+$/.test(line)) ?? "";
  const path = place
    .trim()
    .slice("at ".length)
    .replace(/:2:\d+$/, "");
  expect({ name: basename(path), canBeOpened: existsSync(path) }).toEqual({ name: "main.mjs", canBeOpened: true });
  expect(exitCode).toBe(1);
}, 120_000);
