// Ends a child process that holds more memory than it may, so that no test fills the machine it runs on.
import { readFileSync } from "fs";
import { totalmem } from "os";

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

/**
 * Returns a function that watches a child until the watch is disposed of. Once the children that are watched hold more than `limit` bytes together all of them are killed, and `exceeded`
 * of each says so. Linux alone.
 */
export function endAtMemoryLimitTogether(limit = memoryLimitOfCommandsAtOnce) {
  type Child = { pid: number; kill(signal: "SIGKILL"): void };
  const watches = new Map<Child, { exceeded: boolean }>();
  let timer: Timer | undefined;
  const check = () => {
    let held = 0;
    // Without the pages of files, which children of one executable share.
    for (const child of watches.keys()) held += residentMemory(child.pid, "RssAnon");
    if (held <= limit) return;
    for (const [child, watch] of watches) {
      watch.exceeded = true;
      child.kill("SIGKILL");
    }
  };
  return (child: Child) => {
    const watch = {
      exceeded: false,
      [Symbol.dispose]() {
        watches.delete(child);
        if (watches.size) return;
        clearInterval(timer);
        timer = undefined;
      },
    };
    if (process.platform !== "linux") return watch;
    watches.set(child, watch);
    timer ??= setInterval(check, 100).unref();
    return watch;
  };
}
