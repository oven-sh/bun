// Ends a child process that holds more memory than it may, so that no test fills the machine it runs on. The watching is done on a thread of its own, ./memory-watcher.ts: a caller that keeps
// its own thread busy unbinds nobody.
import { existsSync, readdirSync, readFileSync } from "fs";
import { freemem, totalmem } from "os";
import { dirname, join } from "path";

const machine = Math.min(totalmem(), process.constrainedMemory() || Infinity, 64 * 2 ** 30);

/** In bytes, for a process that nobody has seen before. A quarter of the machine or of its container: the few that run at once leave room for everything else on it. */
export const memoryLimit = machine / 4;

/** In bytes, for a build or a program that the tests run every time. */
export const memoryLimitOfAKnownProgram = machine / 2;

/** In bytes, for all the commands that a test file runs at once. The rest is for the test itself and for everything else on the machine. */
export const memoryLimitOfCommandsAtOnce = (machine * 5) / 8;

/** In bytes; 0 where nothing tells. */
export function residentMemory(pid: number, field = "VmRSS") {
  try {
    if (process.platform === "linux")
      return (
        Number(new RegExp(`^${field}:\\s*(\\d+) kB`, "m").exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) *
        1024
      );
    if (process.platform === "darwin")
      return Number(Bun.spawnSync(["/bin/ps", "-o", "rss=", "-p", String(pid)]).stdout.toString()) * 1024;
  } catch {}
  return 0;
}

/** What the kernel says of the memory of a process, on one line. Nothing where it does not say. */
export function describeMemory(pid: number) {
  const pick = (file: string, fields: string[]) => {
    const text = readFileSync(file, "utf8");
    return fields.flatMap(
      field => new RegExp(`^${field}:\\s*\\d+( kB)?`, "m").exec(text)?.[0].replace(/\s+/g, " ") ?? [],
    );
  };
  try {
    return [
      ...pick(`/proc/${pid}/status`, ["VmRSS", "RssAnon", "RssFile", "RssShmem", "VmData", "VmStk", "Threads"]),
      ...pick(`/proc/${pid}/smaps_rollup`, ["AnonHugePages"]),
      `transparent huge pages: ${readFileSync("/sys/kernel/mm/transparent_hugepage/enabled", "utf8").trim()}`,
    ].join(", ");
  } catch {
    return "";
  }
}

/** What the thread that watches is told. */
export type Told =
  | {
      watch: number;
      pid: number;
      leadsAGroup: boolean;
      shared: SharedArrayBuffer;
      limit: number;
      asksFirst: boolean;
      hasChildren: boolean;
      of?: number;
    }
  | { together: number; shared: SharedArrayBuffer; limit: number; ends: "all" | "the fattest" }
  | { forget: number };

/** A child is known by its number, and ended by it. `leadsAGroup`: the whole process group that it leads is ended with it. */
type Child = { pid: number; leadsAGroup?: boolean };

let watcher: Worker | undefined;
let told = 0;
function tell(message: Told) {
  if (!watcher) {
    watcher = new Worker(new URL("./memory-watcher.ts", import.meta.url).href);
    watcher.unref();
  }
  watcher.postMessage(message);
}

/** What the watcher writes is read out of memory that both threads share: a watch answers at once, whoever is busy. */
function watched(
  child: Child,
  more: Pick<Extract<Told, { watch: number }>, "limit" | "asksFirst" | "hasChildren" | "of">,
  isDone = () => {},
) {
  const shared = new SharedArrayBuffer(1024);
  const words = new Int32Array(shared, 0, 2);
  const watch = ++told;
  // Nothing tells on Windows.
  const isWatched = process.platform !== "win32";
  if (isWatched) tell({ watch, pid: child.pid, leadsAGroup: !!child.leadsAGroup, shared, ...more });
  return {
    get exceeded() {
      return Atomics.load(words, 0) === 1;
    },
    get held() {
      return this.exceeded ? new TextDecoder().decode(new Uint8Array(shared, 16, words[1]).slice()) : "";
    },
    get peak() {
      return new Float64Array(shared, 8, 1)[0];
    },
    [Symbol.dispose]() {
      if (isWatched) tell({ forget: watch });
      isDone();
    },
  };
}

/**
 * Kills the child once it holds more than `limit` bytes. `exceeded` says whether it came to that, and `held` what it held then. Dispose of it when the child has ended.
 * `asksFirst`: the child has a second to say what it is doing. `hasChildren`: what the child starts counts as its own.
 */
export function endAtMemoryLimit(child: Child, limit = memoryLimit, asksFirst = false, hasChildren = false) {
  return watched(child, { limit, asksFirst, hasChildren });
}

/** The control groups that this process is in and that have a bound, from the innermost outwards. */
function findBoundedControlGroups() {
  const bounded: { folder: string; bound: number }[] = [];
  try {
    const top = "/sys/fs/cgroup";
    let folder = join(top, /^0::(.*)$/m.exec(readFileSync("/proc/self/cgroup", "utf8"))?.[1] ?? "/");
    for (; folder.length > top.length || folder === top; folder = dirname(folder)) {
      // The outermost group of a machine has no such file. That of a container has.
      if (!existsSync(`${folder}/memory.max`)) continue;
      const bound = Number(readFileSync(`${folder}/memory.max`, "utf8"));
      if (bound) bounded.push({ folder, bound });
    }
  } catch {}
  return bounded;
}
let boundedControlGroups: ReturnType<typeof findBoundedControlGroups> | undefined;

/** In bytes: what the machine, or the container, can still hand out. */
export function availableMemory() {
  // Elsewhere the system counts only pages that nobody has ever used, which says little.
  if (process.platform !== "linux") return totalmem() / 2;
  let available = freemem();
  try {
    available = Number(/^MemAvailable:\s*(\d+) kB/m.exec(readFileSync("/proc/meminfo", "utf8"))![1]) * 1024;
    for (const { folder, bound } of (boundedControlGroups ??= findBoundedControlGroups())) {
      const parts = readFileSync(`${folder}/memory.stat`, "utf8");
      const part = (name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(parts)?.[1] ?? 0);
      // A group gives back the pages of files, but for those that lie in memory alone.
      const held = Number(readFileSync(`${folder}/memory.current`, "utf8")) - part("file") + part("shmem");
      available = Math.min(available, bound - held);
    }
  } catch {}
  return available;
}

/** A process with what it has started, as far as the kernel tells. */
export function processesBelow(pid: number): number[] {
  const all = [pid];
  if (process.platform !== "linux") return all;
  for (let next = 0; next < all.length; next++) {
    try {
      for (const task of readdirSync(`/proc/${all[next]}/task`))
        all.push(
          ...readFileSync(`/proc/${all[next]}/task/${task}/children`, "utf8").split(" ").filter(Boolean).map(Number),
        );
    } catch {}
  }
  return all;
}

/**
 * Watches the children that run at once, each until its watch is disposed of, so that together they never fill the machine.
 * Once they hold more than `limit` bytes together, or the machine has less left than a seventh of that, `ends` says who is killed: all of them, or the one that holds most, alone.
 * `exceeded` of a watch says that its child was killed so, `held` what it held then, `peak` the most that it was seen to hold. Nothing tells on Windows.
 */
export function endAtMemoryLimitTogether(limit = memoryLimitOfCommandsAtOnce, ends: "all" | "the fattest" = "all") {
  const isLinux = process.platform === "linux";
  const keptBack = limit / 7;
  const shared = new SharedArrayBuffer(8);
  const heldAtLastLook = new Float64Array(shared);
  const together = ++told;
  let isTold = false;
  let watches = 0;
  return {
    /** Whether one more may start: nothing runs, or twice as much is left as has to be. */
    hasRoom: () =>
      !watches || (heldAtLastLook[0] + 2 * keptBack < limit && (!isLinux || availableMemory() > 2 * keptBack)),
    /** `hasChildren`: what the child starts counts as its own. */
    watch(child: Child, hasChildren = false) {
      if (!isTold && process.platform !== "win32") tell({ together, shared, limit, ends });
      isTold = true;
      watches++;
      return watched(child, { limit, asksFirst: false, hasChildren, of: together }, () => void watches--);
    },
  };
}
