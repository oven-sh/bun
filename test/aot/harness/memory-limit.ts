// Ends a child process that holds more memory than it may, so that no test fills the machine it runs on.
import { readFileSync } from "fs";
import { totalmem } from "os";

const machine = Math.min(totalmem(), process.constrainedMemory() || Infinity, 64 * 2 ** 30);

/** In bytes, for a process that nobody has seen before. A quarter of the machine or of its container: the few that run at once leave room for everything else on it. */
export const memoryLimit = machine / 4;

/** In bytes, for a build or a program that the tests run every time. */
export const memoryLimitOfAKnownProgram = machine / 2;

/** In bytes; 0 where nothing tells. */
function residentMemory(pid: number) {
  try {
    if (process.platform === "linux")
      return Number(/^VmRSS:\s*(\d+) kB/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024;
    if (process.platform === "darwin")
      return Number(Bun.spawnSync(["/bin/ps", "-o", "rss=", "-p", String(pid)]).stdout.toString()) * 1024;
  } catch {}
  return 0;
}

/** Kills the child once it holds more than `limit` bytes. `exceeded` says whether it came to that. Dispose of it when the child has ended. */
export function endAtMemoryLimit(child: { pid: number; kill(signal: "SIGKILL"): void }, limit = memoryLimit) {
  const timer = setInterval(
    () => {
      if (residentMemory(child.pid) <= limit) return;
      watch.exceeded = true;
      child.kill("SIGKILL");
    },
    process.platform === "linux" ? 100 : 1000,
  );
  timer.unref();
  const watch = { exceeded: false, [Symbol.dispose]: () => clearInterval(timer) };
  return watch;
}
