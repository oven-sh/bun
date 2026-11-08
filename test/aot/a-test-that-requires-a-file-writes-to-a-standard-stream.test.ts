// `require("./m.cjs"); process.stderr.write("x\n")` in a test file. A file that is required may be taken out of require.cache and read again from disk, so the image of such a test run
// lets the library run from its text. The build had left the function that makes the whole stream out, because the program asks process.stderr for `write` alone. Native code took "its
// text may run" for "it was not left out", made the whole stream from the text, and that text called what else the build had left out:
// "'EventEmitter' was not compiled into this executable because your code never calls it".
// The project stands alone: beside a test file that asks a stream for more, the build keeps that function.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

async function linesOf(flags: string[]) {
  using dir = tempDir("aot-require-and-write", {
    "m.cjs": `exports.a = "first";\n`,
    "a.test.mjs": `import { test } from "bun:test";\ntest("t", () => { require("./m.cjs"); process.stderr.write("OUT written\\n"); });\n`,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

test("a file is required", async () => {
  const plain = await linesOf([]);
  expect(plain).toEqual({ exitCode: 0, lines: ["OUT written"] });
  expect(await linesOf(["--aot"])).toEqual(plain);
}, 240_000);
