// Ends a child process that holds more memory than it may, so that no test fills the machine it runs on.
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
function residentMemory(pid: number, field = "VmRSS") {
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
function describeMemory(pid: number) {
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

/**
 * Kills the child once it holds more than `limit` bytes. `exceeded` says whether it came to that, and `held` what it held then. Dispose of it when the child has ended.
 * `asksFirst`: the child has a second to say what it is doing.
 */
export function endAtMemoryLimit(
  child: { pid: number; kill(signal: "SIGKILL" | "SIGTERM"): void },
  limit = memoryLimit,
  asksFirst = false,
) {
  const timer = setInterval(
    () => {
      if (watch.exceeded || residentMemory(child.pid) <= limit) return;
      watch.exceeded = true;
      watch.held = describeMemory(child.pid);
      if (!asksFirst) return child.kill("SIGKILL");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    },
    process.platform === "linux" ? 100 : 1000,
  );
  timer.unref();
  const watch = { exceeded: false, held: "", [Symbol.dispose]: () => clearInterval(timer) };
  return watch;
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
function processesBelow(pid: number): number[] {
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
  type Child = { pid: number; kill(signal: "SIGKILL"): void };
  type Watch = { exceeded: boolean; held: string; peak: number; hasChildren: boolean };
  const watches = new Map<Child, Watch>();
  const isLinux = process.platform === "linux";
  const keptBack = limit / 7;
  const inMB = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MB`;
  let timer: Timer | undefined;
  // The kernel takes a moment to take back what a killed process held.
  let waitsUntil = 0;
  let heldAtLastLook = 0;
  const check = () => {
    let held = 0;
    let fattest: [Child, Watch, number] | undefined;
    for (const [child, watch] of watches) {
      if (watch.exceeded) continue;
      let own = 0;
      // Without the pages of files, which children of one executable share.
      for (const pid of watch.hasChildren ? processesBelow(child.pid) : [child.pid])
        own += residentMemory(pid, isLinux ? "RssAnon" : undefined);
      watch.peak = Math.max(watch.peak, own);
      held += own;
      if (!fattest || own > fattest[2]) fattest = [child, watch, own];
    }
    heldAtLastLook = held;
    if (!fattest || performance.now() < waitsUntil) return;
    if (held <= limit && !(isLinux && availableMemory() < keptBack)) return;
    waitsUntil = performance.now() + 250;
    for (const [child, watch] of ends === "all" ? watches : [fattest]) {
      if (watch.exceeded) continue;
      watch.exceeded = true;
      watch.held = `it held ${inMB(watch.peak)} of the ${inMB(held)} that ${watches.size} processes held together, which may hold ${inMB(limit)}`;
      child.kill("SIGKILL");
    }
  };
  return {
    /** Whether one more may start: nothing runs, or twice as much is left as has to be. */
    hasRoom: () =>
      !watches.size || (heldAtLastLook + 2 * keptBack < limit && (!isLinux || availableMemory() > 2 * keptBack)),
    /** `hasChildren`: what the child starts counts as its own. */
    watch(child: Child, hasChildren = false) {
      const watch = {
        exceeded: false,
        held: "",
        peak: 0,
        hasChildren,
        [Symbol.dispose]() {
          watches.delete(child);
          if (watches.size) return;
          clearInterval(timer);
          timer = undefined;
          heldAtLastLook = 0;
        },
      };
      if (process.platform === "win32") return watch;
      watches.set(child, watch);
      // A process can grow by 400 MB a second.
      timer ??= setInterval(check, isLinux ? 50 : 1000).unref();
      return watch;
    },
  };
}
