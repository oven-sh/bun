// Single-instance lock — backs app.requestSingleInstanceLock and friends.
//
// Uses atomic exclusive file creation as the lock primitive: the first process
// to create the lock file holds the lock; a second process sees EEXIST and is
// the "second instance". A stale lock (owner pid no longer alive) is taken
// over. The lock path is per-app (overridable via env for tests).

import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let held = false;
let lockPath: string | null = null;

function defaultLockPath(appName: string): string {
  if (process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK) {
    return process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK;
  }
  const safe = appName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(os.tmpdir(), `bun-electron-${safe}.lock`);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH => no such process; EPERM => exists but not ours (alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function requestSingleInstanceLock(appName: string): boolean {
  if (held) return true;
  const p = defaultLockPath(appName);
  lockPath = p;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(p, "wx"); // exclusive create
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      held = true;
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Lock file exists; if its owner is dead, remove and retry once.
      let stale = false;
      try {
        const owner = Number(readFileSync(p, "utf8").trim());
        stale = !Number.isInteger(owner) || owner <= 0 || !pidAlive(owner);
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          unlinkSync(p);
        } catch {}
        continue;
      }
      return false;
    }
  }
  return false;
}

export function hasSingleInstanceLock(): boolean {
  return held;
}

export function releaseSingleInstanceLock(): void {
  if (!held || !lockPath) return;
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {}
  held = false;
}
