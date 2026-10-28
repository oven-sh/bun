import { dlopen, FFIType, ptr, read } from "bun:ffi";

const peekText = 1,
  singleStep = 9,
  getRegisters = 12,
  detach = 17,
  runToSystemCall = 24,
  seize = 0x4206,
  interrupt = 0x4207;
const reportSystemCallsApart = 1,
  killWithTracer = 0x100000;
const anyChild = 0x40000000,
  interruptedCall = 4;
const trap = 5,
  systemCallStop = trap | 0x80,
  killSystemCall = 62;
const secondArgument = 13 * 2,
  systemCallNumber = 15 * 2,
  instructionPointer = 16 * 2,
  numberOfRegisters = 27;

function openLibc() {
  return dlopen("libc.so.6", {
    ptrace: { args: [FFIType.i64, FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i64_fast },
    waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  }).symbols;
}

let libc: ReturnType<typeof openLibc> | undefined;
const status = new Int32Array(new ArrayBuffer(8));
const registers = new Uint32Array(new ArrayBuffer(numberOfRegisters * 8));

function spawnWaitingForLine(command: string[], env: Record<string, string | undefined>) {
  return Bun.spawn({
    cmd: ["/bin/sh", "-c", 'read line; exec "$0" "$@"', ...command],
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function whyTracingIsUnavailable(): Promise<string | undefined> {
  if (process.platform !== "linux" || process.arch !== "x64") return "indirect jumps are counted on Linux x64 only";
  libc ??= openLibc();
  const child = spawnWaitingForLine(["true"], {});
  const refused = libc.ptrace(seize, child.pid, 0, killWithTracer);
  const errno = read.i32(libc.__errno_location()!, 0);
  if (!refused) libc.ptrace(detach, child.pid, 0, 0);
  child.stdin.end();
  await child.exited;
  return refused ? `ptrace is not allowed here (errno ${errno})` : undefined;
}

const legacyPrefixes = new Set([0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0x66, 0xf2, 0xf3]);

function isIndirectJump(bytes: number[]) {
  let at = 0;
  while (legacyPrefixes.has(bytes[at])) at++;
  if (bytes[at] >= 0x40 && bytes[at] <= 0x4f) at++;
  return bytes[at] === 0xff && ((bytes[at + 1] >> 3) & 7) === 4;
}

export async function countIndirectJumps(
  command: string[],
  env: Record<string, string | undefined>,
  numberOfWindows: number,
): Promise<{ windows: Map<number, number>[]; stdout: string; stderr: string; exitCode: number }> {
  const { ptrace, waitpid, __errno_location } = (libc ??= openLibc());
  const statusPointer = ptr(status),
    registersPointer = ptr(registers);
  const child = spawnWaitingForLine(command, env);
  const pid = child.pid;
  try {
    const waitForStop = () => {
      while (waitpid(pid, statusPointer, anyChild) !== pid) {
        const errno = read.i32(__errno_location()!, 0);
        if (errno !== interruptedCall) throw new Error(`${command[0]} is gone before its last mark (errno ${errno})`);
      }
      if ((status[0] & 0xff) !== 0x7f) throw new Error(`${command[0]} ended before its last mark (status ${status[0]})`);
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
    const register = (index: number) => registers[index + 1] * 0x100000000 + registers[index];
    const known = new Map<number, boolean>();
    const isIndirectJumpAt = (address: number) => {
      let answer = known.get(address);
      if (answer === undefined) {
        const word = BigInt.asUintN(64, BigInt(ptrace(peekText, pid, address, 0)));
        answer = isIndirectJump(Array.from({ length: 8 }, (_, index) => Number((word >> BigInt(8 * index)) & 0xffn)));
        known.set(address, answer);
      }
      return answer;
    };

    if (ptrace(seize, pid, 0, reportSystemCallsApart | killWithTracer)) throw new Error("ptrace refused to attach");
    ptrace(interrupt, pid, 0, 0);
    waitForStop();
    child.stdin.write("\n");
    child.stdin.end();

    const windows: Map<number, number>[] = [];
    let signal = 0;
    while (windows.length < numberOfWindows) {
      for (;;) {
        ptrace(runToSystemCall, pid, 0, signal);
        signal = 0;
        const stopped = waitForStop(),
          stopSignal = (stopped >> 8) & 0xff;
        if (stopSignal === systemCallStop) {
          if (!isAtMark()) continue;
          ptrace(runToSystemCall, pid, 0, 0);
          waitForStop();
          break;
        }
        if (!(stopped >> 16) && stopSignal !== trap) signal = stopSignal;
      }
      const window = new Map<number, number>();
      for (;;) {
        ptrace(getRegisters, pid, 0, registersPointer);
        const at = register(instructionPointer);
        if (isIndirectJumpAt(at)) window.set(at, (window.get(at) ?? 0) + 1);
        ptrace(singleStep, pid, 0, signal);
        signal = 0;
        const stopped = waitForStop(),
          stopSignal = (stopped >> 8) & 0xff;
        if (stopped >> 16) continue;
        if (stopSignal !== trap) {
          signal = stopSignal;
          continue;
        }
        if (isAtMark()) break;
      }
      windows.push(window);
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
