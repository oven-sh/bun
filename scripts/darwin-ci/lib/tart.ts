import { $, type Subprocess } from "bun";
import { mkdirSync, rmdirSync, rmSync } from "node:fs";
import { config } from "./config";
import { output, poll, portOpen, sleep, succeeds } from "./shell";

const bin = config.tart.bin;
const cloneLock = "/tmp/tart-clone.lock.d";

export const tart = {
  pull: (image: string) => $`${bin} pull ${image}`,

  clone: (from: string, to: string) => $`${bin} clone ${from} ${to}`.quiet(),

  configure: (vm: string, cpu: number, memoryMb: number) =>
    $`${bin} set ${vm} --cpu ${cpu} --memory ${memoryMb}`.quiet(),

  start(vm: string, logPath: string): Subprocess {
    const log = Bun.file(logPath);
    return Bun.spawn([bin, "run", vm, "--no-graphics"], { stdin: "ignore", stdout: log, stderr: log });
  },

  ip: async (vm: string) => (await output($`${bin} ip ${vm}`)) || undefined,

  exec: (vm: string, script: string) => $`${bin} exec ${vm} /bin/bash -lc ${script}`.quiet(),

  stop: (vm: string) => $`${bin} stop ${vm} --timeout 5`.quiet().nothrow(),

  remove: (vm: string) => $`${bin} delete ${vm}`.quiet().nothrow(),

  rename: (from: string, to: string) => $`${bin} rename ${from} ${to}`.quiet(),

  exists: (vm: string) => succeeds($`${bin} get ${vm}`),

  async destroy(vm: string): Promise<void> {
    await tart.stop(vm);
    await tart.remove(vm);
  },

  // concurrent clones of one image race; macOS has no flock(1)
  async cloneLocked(from: string, to: string): Promise<void> {
    for (let waited = 0; ; waited++) {
      try {
        mkdirSync(cloneLock);
        break;
      } catch {
        if (waited >= 120) {
          rmSync(cloneLock, { recursive: true, force: true });
          waited = 0;
        }
        await sleep(1000);
      }
    }
    try {
      await tart.clone(from, to);
    } finally {
      rmdirSync(cloneLock);
    }
  },

  waitForSsh(vm: string, attempts = 30): Promise<string | undefined> {
    return poll(attempts, 4000, async () => {
      const ip = await tart.ip(vm);
      return ip && (await portOpen(ip, 22)) ? ip : undefined;
    });
  },

  waitForAgent(vm: string): Promise<true | undefined> {
    return poll(30, 4000, async () => ((await succeeds(tart.exec(vm, "true"))) ? true : undefined));
  },
};
