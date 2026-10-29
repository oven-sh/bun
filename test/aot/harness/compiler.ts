import { bunEnv, bunExe } from "harness";

/** Not every build of Bun includes the compiler. One without it says so before it looks for the entry point. */
export const unsupported: string | undefined = /^error: --aot ((?:only supports|isn't available) .*)$/m.exec(
  Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--aot", "./no-such-file.ts"],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  }).stderr.toString(),
)?.[1];
if (unsupported) console.error(`SKIPPED: the tests of --aot in this file: ${unsupported}`);
