// Small programs of one test file in one executable. Each is compiled as it is when it is built alone, and each run is a process of its own.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { join } from "node:path";
import { run } from "./run";

/** Only a canary build of Bun reads BUN_AOT_START_AT. */
export const startsAtAnyEntryPoint = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");
if (!startsAtAnyEntryPoint)
  console.error("SKIPPED: only a canary build of Bun starts an executable at any of its entry points");

/** `entryPoints` are paths in `files`. The build starts with the first test that asks for it. */
export function separatePrograms(
  name: string,
  files: Record<string, string>,
  entryPoints: string[],
  flags: string[] = [],
) {
  const dir = tempDirWithBunTypes(name, files);
  afterAll(() => dir[Symbol.dispose]());
  const folder = String(dir);
  const executable = join(folder, isWindows ? "programs.exe" : "programs");
  let built: Promise<{ stdout: string; stderr: string }> | undefined;

  /** What the build printed. */
  const build = () =>
    (built ??= (async () => {
      const { stdout, stderr, exitCode } = await run(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--aot-separate-programs",
          "--root=.",
          ...flags,
          ...entryPoints.map(entry => "./" + entry),
          "--outfile",
          executable,
        ],
        folder,
      );
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return { stdout, stderr };
    })());

  /** Runs the program that begins at `entry`. */
  async function start(entry: string, env: Record<string, string | undefined> = {}, args: string[] = []) {
    await build();
    return run([executable, ...args], folder, { ...bunEnv, ...env, BUN_AOT_START_AT: entry });
  }

  return { folder, build, start };
}
