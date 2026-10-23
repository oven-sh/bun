import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

const closureCount = isDebug || isASAN ? 4_000 : 80_000;
const timeout = isDebug || isASAN ? 240_000 : 20_000;

// TODO: twice the closures cost 3.8 times the instructions: 80,000 of them take over a minute.
test.todo(
  "build time is linear in the number of closures that capture different variables of one function",
  async () => {
    const lines = Array.from(
      { length: closureCount },
      (_, index) => `  const v${index} = ${index}; all.push(() => v${index});`,
    );
    using dir = tempDir("aot-many-closures", {
      "main.ts": `export function main(): (() => number)[] {\n  const all: (() => number)[] = [];\n${lines.join("\n")}\n  return all;\n}\n`,
    });
    await using checked = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "./main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      checked.stdout.text(),
      checked.stderr.text(),
      checked.exited,
    ]);
    expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  },
  timeout,
);
