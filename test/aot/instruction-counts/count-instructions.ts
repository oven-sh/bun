import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { readFileSync } from "node:fs";

const singleStep = 9,
  getRegisters = 12,
  detach = 17,
  runToSystemCall = 24,
  seize = 0x4206,
  interrupt = 0x4207;
const reportSystemCallsApart = 1,
  killWithTracer = 0x100000;
const noAddressRandomization = 0x0040000,
  currentPersonality = 0xffffffff;
const anyChild = 0x40000000,
  interruptedCall = 4;
const trap = 5,
  systemCallStop = trap | 0x80,
  killSystemCall = 62;
const secondArgument = 13 * 2,
  systemCallNumber = 15 * 2,
  instructionPointer = 16 * 2,
  numberOfRegisters = 27;

export type Range = { start: number; end: number; name: string };
export type Counted = { windows: Map<string, number>[]; stdout: string; stderr: string; exitCode: number };
export type CompiledFunction = { offset: number; size: number; name: string };
export type Request = {
  command: string[];
  env: Record<string, string | undefined>;
  marksBeforeTheFirstWindow: number;
  numberOfWindows: number;
  functions: CompiledFunction[];
};

export function rangesIn(maps: string, executable: string, functions: CompiledFunction[]): Range[] {
  const code = maps
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) r-xp ([0-9a-f]+) \S+ \S+\s+(.*)$/.exec(line))
    .filter(found => found?.[4] === executable)
    .map(found => ({ start: parseInt(found![1], 16), end: parseInt(found![2], 16), offset: parseInt(found![3], 16) }))
    .sort((a, b) => a.offset - b.offset);
  if (code.length < 2) throw new Error("the compiled code of the program is not mapped from the executable");
  const image = code[code.length - 1];
  return [
    ...code.slice(0, -1).map(({ start, end }) => ({ start, end, name: "the runtime" })),
    ...functions
      .filter(compiled => compiled.size > 0)
      .map(({ offset, size, name }) => ({ start: image.start + offset, end: image.start + offset + size, name })),
  ];
}

function openLibc() {
  return dlopen("libc.so.6", {
    ptrace: { args: [FFIType.i64, FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i64_fast },
    waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    personality: { args: [FFIType.u64], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  }).symbols;
}

let libc: ReturnType<typeof openLibc> | undefined;
const status = new Int32Array(new ArrayBuffer(8));
const registers = new Uint32Array(new ArrayBuffer(numberOfRegisters * 8));

function spawnWaitingForALine(command: string[], env: Record<string, string | undefined>) {
  return Bun.spawn({
    cmd: ["/bin/sh", "-c", 'read line; exec "$0" "$@"', ...command],
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function whyInstructionsCannotBeCounted(): Promise<string | undefined> {
  if (process.platform !== "linux" || process.arch !== "x64") return "instructions are counted on Linux x64 only";
  libc ??= openLibc();
  const child = spawnWaitingForALine(["true"], {});
  const refused = libc.ptrace(seize, child.pid, 0, killWithTracer);
  const errno = read.i32(libc.__errno_location()!, 0);
  if (!refused) libc.ptrace(detach, child.pid, 0, 0);
  child.stdin.end();
  await child.exited;
  return refused ? `ptrace is not allowed here (errno ${errno})` : undefined;
}

export const mark = "process.kill(process.pid, 0);";

export async function countInstructions(
  command: string[],
  env: Record<string, string | undefined>,
  marksBeforeTheFirstWindow: number,
  numberOfWindows: number,
  rangesOf: (maps: string) => Range[],
): Promise<Counted> {
  const { ptrace, waitpid, personality, __errno_location } = (libc ??= openLibc());
  const statusPointer = ptr(status),
    registersPointer = ptr(registers);
  const personalityBefore = personality(currentPersonality);
  personality(personalityBefore | noAddressRandomization);
  const child = spawnWaitingForALine(command, env);
  personality(personalityBefore);
  const pid = child.pid;
  try {
    const waitForStop = () => {
      while (waitpid(pid, statusPointer, anyChild) !== pid) {
        const errno = read.i32(__errno_location()!, 0);
        if (errno !== interruptedCall) throw new Error(`${command[0]} is gone before its last mark (errno ${errno})`);
      }
      if ((status[0] & 0xff) !== 0x7f)
        throw new Error(`${command[0]} ended before its last mark (status ${status[0]})`);
      return status[0];
    };
    const isAtMark = () => {
      ptrace(getRegisters, pid, 0, registersPointer);
      return (
        registers[systemCallNumber] === killSystemCall &&
        registers[systemCallNumber + 1] === 0 &&
        registers[secondArgument] === 0 &&
        registers[secondArgument + 1] === 0
      );
    };

    if (ptrace(seize, pid, 0, reportSystemCallsApart | killWithTracer)) throw new Error("ptrace refused to attach");
    ptrace(interrupt, pid, 0, 0);
    waitForStop();
    child.stdin.write("\n");
    child.stdin.end();

    let signal = 0;
    for (let marks = 0; marks < marksBeforeTheFirstWindow; ) {
      ptrace(runToSystemCall, pid, 0, signal);
      signal = 0;
      const stopped = waitForStop(),
        stopSignal = (stopped >> 8) & 0xff;
      if (stopSignal === systemCallStop) {
        if (!isAtMark()) continue;
        ptrace(runToSystemCall, pid, 0, 0);
        waitForStop();
        marks++;
      } else if (!(stopped >> 16) && stopSignal !== trap) signal = stopSignal;
    }

    const ranges = rangesOf(readFileSync(`/proc/${pid}/maps`, "utf8")).sort((a, b) => a.start - b.start);
    const starts = Float64Array.from(ranges, range => range.start);
    const steps = new Float64Array(ranges.length + 1);
    const windows: Map<string, number>[] = [];
    let previous = -1;
    while (windows.length < numberOfWindows) {
      ptrace(singleStep, pid, 0, signal);
      signal = 0;
      const stopped = waitForStop(),
        stopSignal = (stopped >> 8) & 0xff;
      if (stopped >> 16) continue;
      if (stopSignal !== trap) {
        signal = stopSignal;
        continue;
      }
      const atMark = isAtMark();
      const at = registers[instructionPointer + 1] * 0x100000000 + registers[instructionPointer];
      if (at !== previous) {
        let low = 0,
          high = starts.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (starts[middle] <= at) low = middle + 1;
          else high = middle;
        }
        steps[low && at < ranges[low - 1].end ? low - 1 : ranges.length]++;
      }
      previous = at;
      if (!atMark) continue;
      const window = new Map<string, number>();
      steps.forEach((count, index) => {
        if (!count) return;
        const name = index < ranges.length ? ranges[index].name : "elsewhere";
        window.set(name, (window.get(name) ?? 0) + count);
      });
      windows.push(window);
      steps.fill(0);
    }
    ptrace(detach, pid, 0, 0);
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    return { windows, stdout, stderr, exitCode };
  } catch (error) {
    child.kill("SIGKILL");
    const stderr = (await child.stderr.text()).trim();
    throw stderr ? new Error(`${(error as Error).message}\n${stderr}`) : error;
  }
}
