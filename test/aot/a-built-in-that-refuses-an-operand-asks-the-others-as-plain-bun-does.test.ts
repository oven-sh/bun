// `Array.prototype.forEach.call({ get length() { .. } }, 5)` reads the length and throws then; `Object.defineProperty({}, key, 5)` makes a
// key of `key` first. Each shape is a program of its own: beside a call that goes on to its operands the compiler knows of every
// `length` and every toString that it is called, and what it left out elsewhere no longer shows.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { shapes } from "./a-built-in-that-refuses-an-operand-shapes";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

for (const { name, text } of shapes())
  test.concurrent(name, async () => {
    using dir = tempDir("a-built-in-that-refuses-an-operand", { "main.mjs": text });
    const root = realpathSync(String(dir));
    const executable = join(root, "program");
    built(await spawned([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], root, bunEnv));
    const plain = await spawned([bunExe(), "main.mjs"], root, bunEnv);
    const compiled = await spawned([executable], root, bunEnv);
    expect(plain.stdout).toMatch(/ (gave|threw|none)/);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
