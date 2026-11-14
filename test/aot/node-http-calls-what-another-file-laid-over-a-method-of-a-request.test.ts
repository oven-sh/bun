// Each shape is a program of its own: a server, one request, and the process ends.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { shapes } from "./a-method-laid-over-one-of-a-request-shapes";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

// What plain Bun and the compiled program must give for every shape. node:http calls what was laid two times, and util.deprecate()
// warns at the first of them. The warning names the process, and the line below it names the executable.
const said = {
  stdout: "called 2\n",
  stderr: expect.stringMatching(
    /^\(node:\d+\) DeprecationWarning: m\n\(Use `[^`\n]+ --trace-warnings \.\.\.` to show where the warning was created\)\n$/,
  ),
  exitCode: 0,
  signal: null,
};

for (const { name, files } of shapes())
  test.concurrent(name, async () => {
    using dir = tempDir("a-method-laid-over-one-of-a-request", files);
    const root = realpathSync(String(dir));
    const executable = join(root, "program");
    built(await spawned([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], root, bunEnv));
    const plain = await spawned([bunExe(), "main.mjs"], root, bunEnv);
    const compiled = await spawned([executable], root, bunEnv);
    expect(plain).toEqual(said);
    expect(compiled).toEqual(said);
  });
