import type { Subprocess } from "bun";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config";
import { poll, portOpen, probe, run, runInheritOrThrow, sleep, spawn, succeeds } from "./shell";

const bin = config.tart.bin;
// lockf(1) holds a flock(2) on this file for as long as its child runs, and the kernel drops the lock when the child
// exits. The child is a `cat` reading our pipe, so the lock ends when we close the pipe or when this process dies:
// a crashed or killed job cannot leave a stale lock, and there is no pid to go stale or be reused after a reboot.
// Not in /tmp: macOS's daily clean-tmps deletes files untouched for 3 days, lockf never touches this one, and a
// waiter that opens a new file at the path gets a second lock while the first holder still has the old inode.
// ~/.tart belongs to the CI user, who runs both the hooks and bake.
const imageLock = join(homedir(), ".tart", "image.flock");

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

  // concurrent clones of one image race, and so does swapping the image out under a clone
  async withImageLock<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(join(homedir(), ".tart"), { recursive: true });
    const holder = Bun.spawn(["/usr/bin/lockf", "-k", imageLock, "/bin/sh", "-c", "echo locked; exec cat >/dev/null"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = holder.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    if (!value || !new TextDecoder().decode(value).startsWith("locked")) {
      throw new Error(`lockf ${imageLock} exited ${await holder.exited} without taking the lock`);
    }
    try {
      return await fn();
    } finally {
      holder.stdin.end();
      await holder.exited;
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
