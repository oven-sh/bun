import { dlopen, FFIType, ptr } from "bun:ffi";
import { bunEnv, bunExe } from "harness";

export type Cost = { instructions?: number; peakBytes: number };

const killAfterMilliseconds = 60_000;

/**
 * Counts the instructions that a process and everything it starts execute in user mode. The process must be stopped in front of an exec.
 * Call the result once to read the total and close the counter; `readNow()` reads the total so far and leaves the counter open.
 */
export function openInstructionCounter(pid: number) {
  const { syscall, read, close } = dlopen("libc.so.6", {
    syscall: { args: [FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.u64], returns: FFIType.i64 },
    read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
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
  if (counter < 0) return undefined;
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

export const measureCheck = (cwd: string, args: string[]) => measureCommand(cwd, [bunExe(), "check", "--aot", ...args]);

/** The instructions that the command and its children execute in user mode, on all their threads, and the most memory it has resident at a time. */
export async function measureCommand(cwd: string, command: string[], killAfter = killAfterMilliseconds, env: Record<string, string | undefined> = bunEnv, expectedExitCode = 0): Promise<Cost & { stdout: string; stderr: string }> {
  const isDarwin = process.platform === "darwin";
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
  const readInstructions = isDarwin ? undefined : openInstructionCounter(child.pid);
  child.stdin.write("\n");
  child.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const instructions = isDarwin ? Number(/(\d+)\s+instructions retired/.exec(stderr)?.[1]) || undefined : readInstructions?.();
  if (exitCode !== expectedExitCode) throw new Error(`${command.join(" ")}: exit code ${exitCode}, signal ${child.signalCode}\n${stdout}${stderr}`);
  const peakBytes = isDarwin ? Number(/(\d+)\s+maximum resident set size/.exec(stderr)?.[1]) : child.resourceUsage()!.maxRSS;
  return { instructions, peakBytes, stdout, stderr };
}

export async function measureLeast(cwd: string, args: string[], runs: number): Promise<Cost> {
  const all: Cost[] = [];
  for (let run = 0; run < runs; run++) all.push(await measureCheck(cwd, args));
  const counted = all.flatMap(cost => cost.instructions ?? []);
  return { instructions: counted.length === runs ? Math.min(...counted) : undefined, peakBytes: Math.min(...all.map(cost => cost.peakBytes)) };
}
