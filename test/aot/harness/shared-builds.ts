// One folder for all tests of a file, and one build for each command line that they ask for.
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDirWithBunTypes } from "harness";
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

  /** `bun <command> <flags> <entry> --outfile <name>`, once for each list of arguments. It may fail. */
  function tryBuildWith(command: string[], entry: string, ...flags: string[]): Promise<Build> {
    return builds.getOrInsertComputed(JSON.stringify([command, entry, ...flags]), () => {
      const name = `${basename(entry).replace(/\.\w+$/, "")}-${builds.size}`;
      const executable = join(folder, name);
      return inTurn(async () => ({
        ...(await run([bunExe(), ...command, ...flags, ...withoutDebugInformation, entry, "--outfile", name], folder)),
        name,
        executable,
        file: executable + (isWindows ? ".exe" : ""),
      }));
    });
  }

  /** The same, and the build succeeds. */
  async function buildWith(command: string[], entry: string, ...flags: string[]): Promise<Build> {
    const built = await tryBuildWith(command, entry, ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: built.stderr, exitCode: 0 });
    return built;
  }

  const compile = ["build", "--compile"];
  return {
    folder,
    buildWith,
    tryBuildWith,
    /** `bun build --compile <flags> <entry>`. */
    build: (entry: string, ...flags: string[]) => buildWith(compile, entry, ...flags),
    tryBuild: (entry: string, ...flags: string[]) => tryBuildWith(compile, entry, ...flags),
  };
}

export const sizeOf = (build: Build): number => statSync(build.file).size;
