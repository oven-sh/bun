#!/usr/bin/env bun
import { dlopen, FFIType, ptr } from "bun:ffi";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { constants } from "node:os";

const [gigabytes, seconds, ...command] = process.argv.slice(2);
if (!command.length || !(+gigabytes > 0) || !(+seconds > 0)) {
  console.error("usage: bun scripts/aot/capped.ts <GB> <seconds> <command...>");
  process.exit(1);
}
const cap = +gigabytes * 2 ** 30;

let footprint: (pid: number) => number;
if (process.platform === "darwin") {
  const { symbols } = dlopen("/usr/lib/libproc.dylib", {
    proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  });
  const usage = new BigUint64Array(2 + 10);
  footprint = pid => (symbols.proc_pid_rusage(pid, 0, ptr(usage)) === 0 ? Number(usage[2 + 7]) : 0);
} else {
  footprint = pid => {
    try {
      return +(readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+) kB/m)?.[1] ?? 0) * 1024;
    } catch {
      return 0;
    }
  };
}

const child = spawn(command[0], command.slice(1), { stdio: "inherit", detached: true });
const exited = new Promise<number>((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)));
});

const start = performance.now();
const elapsed = () => (performance.now() - start) / 1000;
let peak = 0;
let done = false;
exited.finally(() => (done = true)).catch(() => {});
while (!done) {
  const now = footprint(child.pid!);
  peak = Math.max(peak, now);
  if (now > cap || elapsed() > +seconds) {
    process.kill(-child.pid!, "SIGKILL");
    await exited;
    console.error(
      `\n[capped] killed after ${elapsed().toFixed(1)} s at ${(now / 2 ** 30).toFixed(2)} GB (${now > cap ? "memory cap" : "time limit"})`,
    );
    process.exit(137);
  }
  await Bun.sleep(20);
}
console.error(`[capped] peak ${(peak / 2 ** 30).toFixed(2)} GB, ${elapsed().toFixed(1)} s`);
process.exit(await exited);
