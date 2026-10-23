import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// `import { name } from "./a.js"` where the file has no such export stops the build, as it stops `bun build`. Nothing else in the
// program has the name, so the failed import is all that holds it. The message names the file by its full path, so this is not
// a program with a .build-errors.txt.
test("a missing export of a file is a build error", async () => {
  using dir = tempDir("aot-missing-file-export", {
    "main.js": `import { heldOnlyByFailedImport } from "./a.js";\nconsole.log(typeof heldOnlyByFailedImport);\n`,
    "a.js": `export const present = 1;\n`,
  });
  const outfile = join(String(dir), isWindows ? "program.exe" : "program");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", outfile],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(stderr.split(/\r?\n/).filter(line => line.startsWith("error: "))).toEqual([
    expect.stringMatching(/^error: TS100200: No matching export in ".*a\.js" for import "heldOnlyByFailedImport"$/),
  ]);
  expect(exitCode).toBe(1);
}, 120_000);
