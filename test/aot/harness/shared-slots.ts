// CI runs several test files at once, and each of them counts every processor as its own. That is fine for a file that mostly
// waits. A file whose work keeps every processor busy takes its slots here instead: a slot is a file in a folder that all such
// test files name, so together they run no more at once than one of them would alone, and one that runs alone still gets them all.
import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Between creating a slot's file and writing its number into it, a process holds a file that names nobody.
const longestWithoutName = 10_000;

/** A process that was killed gave nothing back. */
function isAbandoned(path: string) {
  try {
    const holder = Number(readFileSync(path, "utf8"));
    return holder ? !isRunning(holder) : Date.now() - statSync(path).mtimeMs > longestWithoutName;
  } catch {
    // Given back just now.
    return false;
  }
}

function tryCreate(path: string) {
  try {
    const file = openSync(path, "wx");
    writeSync(file, `${process.pid}`);
    closeSync(file);
    return true;
  } catch {
    // Taken. Windows says so in several ways: a file that was deleted while somebody read it cannot be created again until they are done.
    return false;
  }
}

function remove(path: string) {
  try {
    rmSync(path, { force: true });
  } catch {
    // Windows, while somebody reads it. It names this process, so it counts as abandoned once this process has ended.
  }
}

function tryTake(folder: string, count: number) {
  for (let index = 0; index < count; index++) {
    const path = join(folder, `${index}`);
    if (tryCreate(path)) return path;
    if (!isAbandoned(path)) continue;
    remove(path);
    if (tryCreate(path)) return path;
  }
}

function canHoldSlots(folder: string) {
  try {
    mkdirSync(folder, { recursive: true });
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// One of this process's waiters looks at a time.
let lastToLook: Promise<unknown> = Promise.resolve();

/**
 * Runs `work` while no more than `count` pieces of work run at once in all the processes that name `folder`.
 * Where the folder cannot be made or written to, nothing is shared and `work` runs at once: the caller bounds its own process.
 */
export async function sharedSlot<T>(folder: string, count: number, work: () => Promise<T>): Promise<T> {
  if (!canHoldSlots(folder)) return await work();
  const taken = lastToLook.then(async () => {
    for (;;) {
      const path = tryTake(folder, count);
      if (path) return path;
      await sleep(50);
    }
  });
  lastToLook = taken;
  const path = await taken;
  try {
    return await work();
  } finally {
    remove(path);
  }
}
