// A program that asks a standard stream for no more than `fd`, `isTTY`, the size of the terminal and `write` gets a small object for it, a proxy whose other
// traps ask for the whole stream (src/js/builtins/stdio.ts). console.log asks a proxy nothing: it prints the target. So it printed `{}` for a stream that the
// program does nothing else with.
//
// One program prints all three: the whole stream is most of what such a build compiles. The small object of the input is another than that of the outputs.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `console.log(process.stdout);
console.error("behind a text", process.stderr);
console.log(process.stdin);
console.debug({ inside: process.stdin });
`;

test("the standard streams print what bun run prints", async () => {
  using dir = tempDir("aot-standard-stream-printed", { "streams.js": program });
  const directory = String(dir);
  const executable = join(directory, isWindows ? "streams.exe" : "streams");
  const built = await run([bunExe(), "build", "--compile", "--aot", "streams.js", "--outfile", executable], directory);
  expect(built.exitCode).toBe(0);
  const interpreted = await run([bunExe(), "run", "streams.js"], directory, bunEnv);
  const compiled = await run([executable], directory, bunEnv);
  expect(interpreted.stdout).toStartWith("WriteStream {");
  expect(interpreted.stdout).toContain("\nReadStream {");
  expect(interpreted.stderr).toStartWith("behind a text WriteStream {");
  expect(compiled).toEqual(interpreted);
}, 240_000);
