// Runs one command as a child of this process and counts what it costs. ./measure-check.ts calls it, and also runs this file as a program of its own, so
// it imports nothing of the tests' harness.
import { dlopen, FFIType, ptr, read as readMemory } from "bun:ffi";
import { readFileSync, statSync } from "node:fs";
import { endAtMemoryLimit } from "../harness/memory-limit";

/**
 * Counts the instructions that a process and everything it starts execute in user mode. The process must be stopped in front of an exec.
 * Call the result once to read the total and close the counter; `readNow()` reads the total so far and leaves the counter open.
 */
export function openInstructionCounter(pid: number) {
  const { syscall, read, close, __errno_location } = dlopen("libc.so.6", {
    syscall: {
      args: [FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.u64],
      returns: FFIType.i64,
    },
    read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  }).symbols;
  const SYS_perf_event_open = process.arch === "arm64" ? 241 : 298,
    PERF_TYPE_HARDWARE = 0,
    PERF_COUNT_HW_INSTRUCTIONS = 1n,
    sizeofAttr = 128;
  const disabled = 1n << 0n,
    inherit = 1n << 1n,
    exclude_kernel = 1n << 5n,
    exclude_hv = 1n << 6n,
    enable_on_exec = 1n << 12n;
  const attr = new BigUint64Array(sizeofAttr / 8);
  new Uint32Array(attr.buffer).set([PERF_TYPE_HARDWARE, sizeofAttr]);
  attr[1] = PERF_COUNT_HW_INSTRUCTIONS;
  attr[5] = disabled | inherit | exclude_kernel | exclude_hv | enable_on_exec;
  const counter = Number(syscall(SYS_perf_event_open, ptr(attr), pid, -1, -1, 0));
  if (counter < 0) {
    sayOnce(
      `${notCounted}: perf_event_open fails with errno ${readMemory.i32(__errno_location()!, 0)}, kernel.perf_event_paranoid is ${readFileSync("/proc/sys/kernel/perf_event_paranoid", "utf8").trim()}`,
    );
    return undefined;
  }
  const readNow = () => {
    const value = new BigUint64Array(1);
    return Number(read(counter, ptr(value), 8)) === 8 ? Number(value[0]) : undefined;
  };
  const readAndClose = () => {
    const instructions = readNow();
    close(counter);
    return instructions;
  };
  return Object.assign(readAndClose, { readNow });
}

export const notCounted = "instructions are not counted here";
const said = new Set<string>();
/** Once a process. */
export function sayOnce(line: string) {
  if (said.has(line)) return;
  said.add(line);
  console.error(line);
}

export type Measured = {
  instructions?: number;
  /** On Linux never less than the most that this process has had resident: see `measureCommandWithMemory` of ./measure-check.ts. */
  peakBytes: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  signalCode: string | null;
  exceededMemoryLimit: boolean;
};

/**
 * macOS checks each page of an executable against its signature when a process first touches the page, and counts that as instructions of the
 * process: 19 million for a program that prints a line. So a file that was written a moment ago is run once before it is measured.
 */
const filesThatHaveRun = new Set([fileOf(process.execPath)]);
function fileOf(path: string) {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats ? `${stats.dev}:${stats.ino}:${stats.mtimeMs}` : path;
}
async function runOnceUnmeasured(cwd: string, cmd: string[], timeout: number, env: Record<string, string | undefined>) {
  const file = fileOf(cmd[0]);
  if (filesThatHaveRun.has(file)) return;
  filesThatHaveRun.add(file);
  await using child = Bun.spawn({
    cmd,
    cwd,
    env,
    stdio: ["ignore", "ignore", "ignore"],
    timeout,
    killSignal: "SIGKILL",
  });
  await child.exited;
}

export async function measureHere(
  cwd: string,
  command: string[],
  killAfter: number,
  env: Record<string, string | undefined>,
): Promise<Measured> {
  const isDarwin = process.platform === "darwin";
  if (isDarwin) await runOnceUnmeasured(cwd, command, killAfter, env);
  await using child = Bun.spawn({
    cmd: isDarwin ? ["/usr/bin/time", "-l", ...command] : ["/bin/sh", "-c", 'read line; exec "$0" "$@"', ...command],
    cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: killAfter,
    killSignal: "SIGKILL",
  });
  // Several commands are measured at once. On Linux the shell becomes the command, so the child is what holds the memory.
  using held = endAtMemoryLimit(child);
  const readInstructions = isDarwin ? undefined : openInstructionCounter(child.pid);
  child.stdin.write("\n");
  child.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return {
    instructions: isDarwin
      ? Number(/(\d+)\s+instructions retired/.exec(stderr)?.[1]) || undefined
      : readInstructions?.(),
    peakBytes: isDarwin ? Number(/(\d+)\s+maximum resident set size/.exec(stderr)?.[1]) : child.resourceUsage()!.maxRSS,
    stdout,
    stderr,
    exitCode,
    signalCode: child.signalCode,
    exceededMemoryLimit: held.exceeded,
  };
}

if (import.meta.main) {
  const [cwd, command, killAfter, env] = JSON.parse(process.argv.at(-1)!);
  process.stdout.write(JSON.stringify(await measureHere(cwd, command, killAfter, env)));
}
