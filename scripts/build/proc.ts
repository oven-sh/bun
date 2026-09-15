/**
 * Questions about another process by pid, for the build directory lock in build.ts, which is a pid file.
 * A recorded pid says nothing by itself — the process may be gone and the number reused — so identity is
 * checked through the command line.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Whether a process with this pid exists (it may belong to someone else: EPERM counts as alive). */
export function processAlive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The command line of `pid`, or "" if it cannot be read (gone, not ours). Linux: /proc. Windows: CIM via
 * PowerShell (slow — hundreds of ms — so callers cache). Elsewhere: `ps -ww` (BSD ps clips the args column
 * to the terminal width without -ww).
 */
export function processCommandLine(pid: number): string {
  if (!(pid > 0)) return "";
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    if (process.platform === "win32") {
      return (
        spawnSync(
          "powershell",
          ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
          {
            encoding: "utf8",
            windowsHide: true,
          },
        ).stdout ?? ""
      );
    }
    return spawnSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? "";
  } catch {
    return "";
  }
}
