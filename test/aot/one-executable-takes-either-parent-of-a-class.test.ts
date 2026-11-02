// Which of two classes B extends goes by the arguments of the run, and a function makes a class below B: one executable, run both ways, prints what plain Bun prints.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

test("an executable constructs below the first and below the second possible parent", async () => {
  using dir = tempDir("one-executable-takes-either-parent-of-a-class", {
    "main.js": `
      class P { k() { return 1; } }
      class Q { k() { return 2; } }
      class B extends (process.argv.length > 2 ? P : Q) {}
      const derive = (c) => class extends c {};
      console.log(new (derive(B))().k());
    `,
  });
  const root = realpathSync(String(dir));
  const executable = join(root, "program");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], root, bunEnv));
  for (const passed of [[], ["first"]]) {
    const plain = await spawned([bunExe(), "main.js", ...passed], root, bunEnv);
    const compiled = await spawned([executable, ...passed], root, bunEnv);
    expect({ passed, stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      passed,
      stdout: plain.stdout,
      exitCode: 0,
    });
  }
});
