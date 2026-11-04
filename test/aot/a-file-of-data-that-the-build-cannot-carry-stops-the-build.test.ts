import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Plain Bun loads this file, so an error where the executable loads it would be a wrong answer.
test("a TOML file with a date stops the build, though only a computed name could load it", async () => {
  using dir = tempDir("aot-data-that-the-build-cannot-carry", {
    "main.js": `const name = ["dated.toml"][Date.now() > 0 ? 0 : 1];\nconsole.log(typeof (await import("./data/" + name)).default.day);\n`,
    "data/dated.toml": `day = 1979-05-27\n`,
  });
  const outfile = join(String(dir), isWindows ? "program.exe" : "program");
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", outfile],
    String(dir),
  );
  expect(stderr.split(/\r?\n/).filter(line => /^(error|warn)/.test(line))).toEqual([
    expect.stringMatching(/^error: TS100050: --aot does not support a date or time in the TOML file ".*dated\.toml"$/),
  ]);
  expect({ exitCode, isBuilt: existsSync(outfile) }).toEqual({ exitCode: 1, isBuilt: false });
}, 120_000);
