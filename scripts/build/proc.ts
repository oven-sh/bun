/**
 * Questions about another process by pid, for the build directory lock in build.ts, which is a pid file.
 * A recorded pid says nothing by itself — the process may be gone and the number reused — so the lock also
 * records when the process started.
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
 * When `pid` started, as an opaque string that differs between two processes that had the same pid, or "" if it
 * cannot be read (gone, not ours). Linux: field 22 of /proc/<pid>/stat (clock ticks since boot). Windows: CIM's
 * CreationDate via PowerShell (slow — hundreds of ms — so callers ask once per contended lock, not per poll).
 * Elsewhere: `ps -o lstart=`.
 */
export function processStartTime(pid: number): string {
  if (!(pid > 0)) return "";
  try {
    if (process.platform === "linux") {
      // "pid (comm) state ppid …": comm may contain spaces and parentheses, so count fields after the last ")".
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? "";
    }
    if (process.platform === "win32") {
      return (
        spawnSync(
          "powershell",
          ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate.Ticks`],
          { encoding: "utf8", windowsHide: true },
        ).stdout ?? ""
      ).trim();
    }
    return (spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? "").trim();
  } catch {
    return "";
  }
}
