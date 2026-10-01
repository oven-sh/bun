#!/usr/bin/env bun
// Runs a command, and kills it and its process group as soon as it uses too much memory or takes too long.
//
//   bun scripts/aot/capped.ts <GB> <seconds> <command...>
//
// For stress tests and fuzzing, where a compiler bug can allocate until the machine swaps. macOS does not enforce
// RLIMIT_AS or RLIMIT_DATA, so this polls. Exits with the command's exit code, or 137 if it killed it.
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
  // rusage_info_v0: a 16-byte uuid, then 64-bit fields. ri_phys_footprint is the eighth.
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
