// One folder for all tests of a file, and one build for each command line that they ask for.
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { run } from "./run";
import { withoutDebugInformation } from "./without-debug-information";

export type Build = {
  /** As it was given to --outfile. */
  name: string;
  /** What to start. */
  executable: string;
  /** The file on disk. */
  file: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

// A test waits for its builds, and they wait for a core.
setDefaultTimeout(120_000);

let free = availableParallelism();
const waiting: (() => void)[] = [];

/** Runs `work` while no more of them run at once than the machine has cores. */
export async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

export function sharedBuilds(name: string, files: Record<string, string>) {
  const dir = tempDirWithBunTypes(name, files);
  afterAll(() => dir[Symbol.dispose]());
  const folder = String(dir);
  const builds = new Map<string, Promise<Build>>();
  const compile = ["build", "--compile"];

  const named = (name: string) => ({
    name,
    executable: join(folder, name),
    file: join(folder, name) + (isWindows ? ".exe" : ""),
  });

  /** `bun <command> <flags> <entry> --outfile <name>`, once for each list of arguments. It may fail. */
  function tryBuildWith(command: string[], entry: string, ...flags: string[]): Promise<Build> {
    return builds.getOrInsertComputed(JSON.stringify([command, entry, ...flags]), () => {
      const name = `${basename(entry).replace(/\.\w+$/, "")}-${builds.size}`;
      return inTurn(async () => ({
        ...(await run([bunExe(), ...command, ...flags, ...withoutDebugInformation, entry, "--outfile", name], folder)),
        ...named(name),
      }));
    });
  }

  /**
   * `bun build --compile --aot <flags> <entry>` without and with `--trim`. What --trim removes is decided behind the compiler, so one
   * build compiles the program and writes both executables.
   */
  async function buildWholeAndTrimmed(entry: string, ...flags: string[]): Promise<[whole: Build, trimmed: Build]> {
    const name = `${basename(entry).replace(/\.\w+$/, "")}-${builds.size}`;
    const trimmed = builds.getOrInsertComputed(JSON.stringify(["whole and trimmed", entry, ...flags]), () =>
      inTurn(async () => ({
        ...(await run(
          [bunExe(), ...compile, "--aot", "--trim", ...flags, ...withoutDebugInformation, entry, "--outfile", name],
          folder,
          { ...bunEnv, BUN_DEBUG_TEST_UNTRIMMED_OUTFILE: named(name + "-whole").file },
        )),
        ...named(name),
      })),
    );
    const built = await trimmed;
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: built.stderr, exitCode: 0 });
    return [{ ...built, ...named(built.name + "-whole") }, built];
  }

  /** The same, and the build succeeds. */
  async function buildWith(command: string[], entry: string, ...flags: string[]): Promise<Build> {
    const built = await tryBuildWith(command, entry, ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: built.stderr, exitCode: 0 });
    return built;
  }

  return {
    folder,
    buildWith,
    buildWholeAndTrimmed,
    tryBuildWith,
    /** `bun build --compile <flags> <entry>`. */
    build: (entry: string, ...flags: string[]) => buildWith(compile, entry, ...flags),
    tryBuild: (entry: string, ...flags: string[]) => tryBuildWith(compile, entry, ...flags),
  };
}

export const sizeOf = (build: Build): number => statSync(build.file).size;
