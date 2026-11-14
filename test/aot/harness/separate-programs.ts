// Small programs of one test file. Each is built alone, into an executable of its own, and each run is a process of its own.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { join } from "node:path";
import { run } from "./run";

/** Every Bun starts an executable at its one entry point. The tests ask because one executable used to hold all the programs. */
export const startsAtAnyEntryPoint = true;

/** `entryPoints` are paths in `files`. The build of an entry point starts with the first test that asks for it. */
export function separatePrograms(
  name: string,
  files: Record<string, string>,
  entryPoints: string[],
  flags: string[] = [],
) {
  const dir = tempDirWithBunTypes(name, files);
  afterAll(() => dir[Symbol.dispose]());
  const folder = String(dir);
  const executableOf = (entry: string) =>
    join(folder, `programs-${entryPoints.indexOf(entry)}${isWindows ? ".exe" : ""}`);
  const builds = new Map<string, Promise<{ stdout: string; stderr: string }>>();

  /** What the build of the one entry point printed. */
  function buildOf(entry: string) {
    if (!entryPoints.includes(entry)) throw new Error(`${entry} is no entry point of ${name}`);
    return builds.getOrInsertComputed(entry, async () => {
      const { stdout, stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", "--aot", "--root=.", ...flags, "./" + entry, "--outfile", executableOf(entry)],
        folder,
      );
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return { stdout, stderr };
    });
  }

  /** What the builds of all entry points printed, in the order of `entryPoints`. When it answers, every executable is there. */
  async function build() {
    const printed = await Promise.all(entryPoints.map(buildOf));
    return { stdout: printed.map(it => it.stdout).join(""), stderr: printed.map(it => it.stderr).join("") };
  }

  /** Runs the program that begins at `entry`. */
  async function start(entry: string, env: Record<string, string | undefined> = {}, args: string[] = []) {
    await buildOf(entry);
    return run([executableOf(entry), ...args], folder, { ...bunEnv, ...env });
  }

  return { folder, build, start };
}
