// It takes nothing from test/harness.ts: run-parallel.ts, which is no test, imports it too.
//
// Where the kernel hands a core to a program (systemd-coredump, apport) it starts that program whatever the limit is, but for a limit of one byte, and the process that a signal ended is
// gone only when the program has read it: seconds on a busy machine.
// An executable reserves tens of GB of addresses, and all of them are read: minutes.
import { readFileSync } from "node:fs";

// A process whose own limit is nothing may not raise it to a byte, and prlimit then starts nothing. So it is asked once, with a
// command that does nothing: what this process may do, so may all that it starts. Whatever the answer, the command is started.
let inFront: string[] | undefined;
function wordsInFront() {
  if (inFront) return inFront;
  const prlimit = Bun.which("prlimit");
  const toAByte = prlimit ? [prlimit, "--core=1:1"] : undefined;
  const asked = toAByte && Bun.spawnSync([...toAByte, "/bin/sh", "-c", ":"], { stdio: ["ignore", "ignore", "ignore"] });
  return (inFront = asked?.success ? toAByte! : ["/bin/sh", "-c", `ulimit -c 0 2> /dev/null; exec "$@"`, "--"]);
}
export function withoutCoreDump(cmd: string[]) {
  if (process.platform === "win32") return cmd;
  const words = wordsInFront();
  return words.every((word, index) => cmd[index] === word) ? cmd : [...words, ...cmd];
}

export const handsCoresToAProgram = (() => {
  try {
    return readFileSync("/proc/sys/kernel/core_pattern", "utf8").startsWith("|");
  } catch {
    return false;
  }
})();
/**
 * For any command of a test: a signal that nobody expects ends it at once, and the test says which.
 * scripts/runner.node.ts fails a file that leaves a core in a folder, whatever the file says itself: there a command is started as it is.
 */
export const throughAtOnce = (cmd: string[]) => (handsCoresToAProgram ? withoutCoreDump(cmd) : cmd);
/** A Bun that a signal ends starts a command that sends a report, which holds its pipe for errors. It goes where scripts/runner.node.ts says, or nowhere. */
export const reportsToTheRunnerAlone = (env: Record<string, string | undefined>) =>
  env.BUN_CRASH_REPORT_URL || env.BUN_ENABLE_CRASH_REPORTING !== undefined
    ? env
    : { ...env, BUN_ENABLE_CRASH_REPORTING: "0" };
