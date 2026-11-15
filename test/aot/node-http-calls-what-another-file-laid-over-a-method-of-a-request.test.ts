// Each shape is a program of its own: a server, one request, and the process ends.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { shapes } from "./a-method-laid-over-one-of-a-request-shapes";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

for (const { name, files } of shapes())
  test.concurrent(name, async () => {
    using dir = tempDir("a-method-laid-over-one-of-a-request", files);
    const root = realpathSync(String(dir));
    const executable = join(root, "program");
    built(await spawned([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], root, bunEnv));
    const plain = await spawned([bunExe(), "main.mjs"], root, bunEnv);
    const compiled = await spawned([executable], root, bunEnv);
    expect(plain.stdout).toBe("called 2\n");
    // util.deprecate() warns, and the warning names the process.
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
