/**
 * One build at a time per build directory. configure and ninja both rewrite `.ninja_log`, and two ninjas in one
 * directory delete and rewrite each other's crate outputs. A second `bun bd` waits for the first.
 *
 * node has no portable advisory file lock, so the lock is files: `build.lock.<n>`, numbered upwards. The highest
 * number is the current lock. Its contents name the processes that hold it, one `<pid> <start time>` per line
 * (the build driver, then the ninja it started), or say `released`. While any named process is alive the lock is
 * held; otherwise the next number may be created, and a name is created together with its contents in one step
 * that fails if the name exists (written under a private name, then hard-linked), so exactly one contender gets
 * it. No name is reused, moved or emptied, which is what makes a stale lock safe to pass: nothing a contender
 * does can take a live lock away from its holder.
 *
 * A filesystem without hard links (exFAT, some shared folders) cannot do that step. There the build runs
 * unlocked, and says so.
 */

import { linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeError } from "./error.ts";
import { processAlive, processStartTime } from "./proc.ts";

const PREFIX = "build.lock.";
const RELEASED = "released";

export interface BuildDirLock {
  /** Also held by this process from now on: the ninja the driver started, which can outlive the driver. */
  addHolder(pid: number): void;
  release(): void;
}

/** `<pid> <start time>`: the start time tells this process from a later one that was given the same pid. */
function holderLine(pid: number): string {
  return `${pid} ${processStartTime(pid)}`;
}

/** This process's line. Asked for once: on Windows and macOS the start time costs a process spawn, and a waiting build tries again twice a second. */
let ownHolderLine: string | undefined;

/** The lock numbers present, ascending. */
function numbers(buildDir: string): number[] {
  return readdirSync(buildDir)
    .filter(name => name.startsWith(PREFIX) && /^\d+$/.test(name.slice(PREFIX.length)))
    .map(name => Number(name.slice(PREFIX.length)))
    .sort((a, b) => a - b);
}

/** Whether a lock file's contents name a live process. A file that vanished was a lower number being cleaned up. */
function held(path: string): boolean {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  if (contents === RELEASED) return false;
  return contents.split("\n").some(line => {
    // The start time can contain spaces (`ps -o lstart=`): split at the first one only.
    const space = line.indexOf(" ");
    const pid = Number(line.slice(0, space));
    return processAlive(pid) && processStartTime(pid) === line.slice(space + 1);
  });
}

/** Take the lock if nobody holds it; undefined while somebody does. */
export function tryLockBuildDir(buildDir: string): BuildDirLock | undefined {
  mkdirSync(buildDir, { recursive: true });
  const existing = numbers(buildDir);
  const highest = existing.at(-1) ?? 0;
  if (highest > 0 && held(join(buildDir, PREFIX + highest))) return undefined;

  const mine = join(buildDir, PREFIX + (highest + 1));
  const scratch = join(buildDir, `${PREFIX}${process.pid}.tmp`);
  const holders = [(ownHolderLine ??= holderLine(process.pid))];
  writeFileSync(scratch, holders.join("\n"));
  try {
    linkSync(scratch, mine);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return undefined; // another contender got this number
    process.stderr.write(
      `warning: cannot lock ${buildDir} (${describeError(e)}); building without a lock, so run one build of this directory at a time\n`,
    );
    return { addHolder() {}, release() {} };
  } finally {
    rmSync(scratch, { force: true });
  }
  // A contender that listed the directory long ago can create a number below the current lock's (whose holder has
  // cleaned the lower ones up since). Only the highest number is the lock; anything else just goes away.
  if (numbers(buildDir).at(-1) !== highest + 1) {
    rmSync(mine, { force: true });
    return undefined;
  }
  for (const n of existing) rmSync(join(buildDir, PREFIX + n), { force: true });

  // Replacing the contents of our own name is ours alone to do; a reader sees the old or the new holders.
  const rewrite = (contents: string): void => {
    writeFileSync(scratch, contents);
    renameSync(scratch, mine);
  };
  let released = false;
  return {
    addHolder(pid) {
      holders.push(holderLine(pid));
      rewrite(holders.join("\n"));
    },
    release() {
      if (released) return;
      released = true;
      // The file stays, as the record that this number was used: the next lock is the next number.
      rewrite(RELEASED);
    },
  };
}

/** Take the lock, waiting for whoever holds it. Released explicitly, or when this process exits. */
export function lockBuildDir(buildDir: string): BuildDirLock {
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let announced = false;
  for (;;) {
    const lock = tryLockBuildDir(buildDir);
    if (lock !== undefined) {
      process.on("exit", () => lock.release());
      return lock;
    }
    if (!announced) process.stderr.write(`waiting for another build in ${buildDir} to finish…\n`);
    announced = true;
    sleep(500);
  }
}
