// `function f(object) { const result = object.method(); return result; }`: the call ends f, so f has left the stack when the method begins. The read of `method`
// comes first: a getter that runs under it still has f below it. Where f is inlined into a hot loop and other classes of the program have a `method`, the read and
// the call are one operation with one return address, and a stack trace took the read for the call: f was missing. The stored program shows it only beside these
// two others, and which programs share a build is dealt anew whenever a program comes: so the three are built together here.
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

const root = join(import.meta.dir, "parallel");
const program = "errors/stack-positions-method-calls-read-throws.js";
const others = [
  "declarations/text-of-functions-declared-in-blocks.ts",
  "errors/stack-positions-disposals-comparisons.mjs",
];

describe("compile/aot/a getter under the read of a method has the reader below it", () => {
  const folder = String(tempDir("aot-read-in-front-of-a-tail-call", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("three stored programs as one program", async () => {
    const executable = join(folder, isWindows ? "programs.exe" : "programs");
    built(
      await spawned(
        [
          bunExe(),
          ...compileCommand,
          `--root=${root}`,
          ...withoutDebugInformation(),
          ...[program, ...others].map(file => "./" + file),
          "--outfile",
          executable,
        ],
        root,
        bunEnv,
      ),
    );
    const cwd = dirname(join(root, program));
    const [compiled, plain] = await Promise.all([
      spawned([executable], cwd, bunEnv),
      spawned([bunExe(), join(root, program)], cwd, bunEnv),
    ]);
    expect(plain.stdout).toContain("withoutArguments throwsInGetter | Error | 17:51 39:18\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 300_000);
});
