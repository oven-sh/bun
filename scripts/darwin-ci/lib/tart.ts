import type { Subprocess } from "bun";
import { readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { config } from "./config";
import { poll, portOpen, probe, run, runInheritOrThrow, sleep, spawn, succeeds } from "./shell";

const bin = config.tart.bin;
// a symlink whose target is the holder's pid: creation is atomic and carries the owner in one syscall
const imageLock = "/tmp/tart-image.lock";

function lockOwner(): number | undefined {
  try {
    return Number(readlinkSync(imageLock));
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const tart = {
  pull: (image: string) => runInheritOrThrow([bin, "pull", image]),

  clone: (from: string, to: string) => run([bin, "clone", from, to]),

  configure: (vm: string, cpu: number, memoryMb: number) =>
    run([bin, "set", vm, "--cpu", String(cpu), "--memory", String(memoryMb)]),

  start(vm: string, logPath: string): Subprocess {
    const log = Bun.file(logPath);
    return Bun.spawn([bin, "run", vm, "--no-graphics"], { stdin: "ignore", stdout: log, stderr: log });
  },

  ip: (vm: string) => probe([bin, "ip", vm]),

  exec: (vm: string, script: string) => run([bin, "exec", vm, "/bin/bash", "-lc", script]),

  async stop(vm: string): Promise<void> {
    const { exitCode, stderr } = await spawn([bin, "stop", vm, "--timeout", "5"]);
    if (exitCode !== 0 && !stderr.includes("is not running")) throw new Error(`tart stop ${vm}: ${stderr.trim()}`);
  },

  remove: (vm: string) => run([bin, "delete", vm]),

  rename: (from: string, to: string) => run([bin, "rename", from, to]),

  exists: (vm: string) => succeeds([bin, "get", vm]),

  async destroy(vm: string): Promise<void> {
    if (!(await tart.exists(vm))) return;
    await tart.stop(vm);
    // `tart stop` returns once the guest pid is gone, but `tart run` holds the vm lock a little longer and delete fails until it lets go
    for (let attempt = 0; ; attempt++) {
      const { exitCode, stderr } = await spawn([bin, "delete", vm]);
      if (exitCode === 0) return;
      if (attempt >= 10 || !stderr.includes("is running")) throw new Error(`tart delete ${vm}: ${stderr.trim()}`);
      await sleep(500);
    }
  },

  // concurrent clones of one image race, and so does swapping the image out under a clone; macOS has no flock(1)
  async withImageLock<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        symlinkSync(String(process.pid), imageLock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = lockOwner();
        if (owner !== undefined && !processAlive(owner)) {
          console.log(`${imageLock} held by dead pid ${owner}; removing`);
          rmSync(imageLock, { force: true });
          continue;
        }
        await sleep(1000);
      }
    }
    try {
      return await fn();
    } finally {
      if (lockOwner() === process.pid) unlinkSync(imageLock);
    }
  },

  cloneLocked: (from: string, to: string) => tart.withImageLock(() => tart.clone(from, to)),

  waitForSsh(vm: string, attempts = 30): Promise<string | undefined> {
    return poll(attempts, 4000, async () => {
      const ip = await tart.ip(vm);
      return ip && (await portOpen(ip, 22)) ? ip : undefined;
    });
  },

  waitForAgent(vm: string): Promise<true | undefined> {
    return poll(30, 4000, async () => ((await succeeds([bin, "exec", vm, "true"])) ? true : undefined));
  },
};
