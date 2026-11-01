// A program that asks a standard stream for no more than `fd`, `isTTY`, the size of the terminal and `write` gets a small object for it, a proxy whose other
// traps ask for the whole stream (src/js/builtins/stdio.ts). console.log asks a proxy nothing: it prints the target. So it printed `{}` for a stream that the
// program does nothing else with.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

const programs = {
  "output.js": `console.log(process.stdout);\n`,
  "errors.js": `console.error("behind a text", process.stderr);\n`,
  "inside.js": `console.info({ inside: process.stdout }, [process.stderr]);\n`,
  "input.js": `console.log(process.stdin);\nconsole.debug({ inside: process.stdin });\n`,
};

// inside.js was right when the others were wrong: the benches run it.
test.concurrent.each(Object.keys(programs).filter(entry => runsWholeGrids || entry !== "inside.js"))(
  "%s prints what bun run prints",
  async entry => {
    using dir = tempDir("aot-standard-stream-printed", programs);
    const directory = String(dir);
    const executable = join(directory, entry.replace(/\.js$/, isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], directory);
    expect(built.exitCode).toBe(0);
    const interpreted = await run([bunExe(), "run", entry], directory, bunEnv);
    const compiled = await run([executable], directory, bunEnv);
    expect(interpreted.stdout + interpreted.stderr).toContain("Stream {");
    expect(compiled).toEqual(interpreted);
  },
  240_000,
);
