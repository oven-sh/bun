import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "./supported";

// What the build refuses it names by file and line. The file has to be named as the system names it: on Windows the message
// used to read "/C:/a/main.cjs:2", which is how the type checker writes a path and nothing that can be opened.
test("an error of an --aot build names the file by a path that can be opened", async () => {
  using dir = tempDir("aot-build-error-paths", {
    "main.cjs": `console.log("first line");\nconsole.log(require("./waits.mjs").a);\n`,
    "waits.mjs": `await 0;\nexport const a = 1;\n`,
  });
  const outfile = join(String(dir), isWindows ? "program.exe" : "program");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", outfile],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  const line = stderr.split(/\r?\n/).find(line => line.includes("--aot does not support")) ?? "";
  expect(line).toStartWith("error: ");
  const path = line.slice("error: ".length, line.indexOf(":2: --aot does not support"));
  expect({ name: basename(path), canBeOpened: existsSync(path) }).toEqual({ name: "main.cjs", canBeOpened: true });
  expect(exitCode).toBe(1);
}, 120_000);
