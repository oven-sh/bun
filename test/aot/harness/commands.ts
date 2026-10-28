// How the tests of test/aot start a command, and what they make of how it ended.
import { expect, setDefaultTimeout } from "bun:test";
import { closeSync, existsSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, utimesSync } from "fs";
import { bunExe, isASAN, isLinux, isWindows } from "harness";
import { availableParallelism, tmpdir } from "os";
import { join } from "path";
import { locksEnvironment } from "../hardened";
import { endAtMemoryLimit, memoryLimitOfAKnownProgram } from "./memory-limit";

export { unsupported } from "./compiler";

// One build takes about as long as the whole default limit of bun:test.
setDefaultTimeout(120_000);

// Each build keeps one core busy for about a second and writes an executable the size of Bun.
const slots = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism());
let free = slots;
const waiting: (() => void)[] = [];
const takeSlot = (isNext = false) =>
  free > 0 ? void free-- : new Promise<void>(resolve => (isNext ? waiting.unshift(resolve) : waiting.push(resolve)));
function giveSlot() {
  const next = waiting.shift();
  if (next) next();
  else free++;
}
export async function slot<T>(work: () => Promise<T>): Promise<T> {
  await takeSlot();
  try {
    return await work();
  } finally {
    giveSlot();
  }
}

let lastAlone: Promise<unknown> = Promise.resolve();
/** Runs `work` while nothing else that takes a slot runs. `held`: how many slots the caller holds; it gives them up for that long. */
export async function withEverySlot<T>(held: 0 | 1, work: () => Promise<T>): Promise<T> {
  if (held) giveSlot();
  const mine = lastAlone.then(async () => {
    for (let taken = 0; taken < slots; taken++) await takeSlot(true);
    try {
      return await work();
    } finally {
      for (let given = 0; given < slots; given++) giveSlot();
    }
  });
  lastAlone = mine.catch(() => {});
  try {
    return await mine;
  } finally {
    if (held) await takeSlot(true);
  }
}

// AOT_BUILD_FLAGS="--aot-validate": every build with --aot or by `bun compile` that a test file starts through spawned() takes these flags too: a whole file, such as servers/servers.test.ts, in a checking build.
const moreBuildFlags = (process.env.AOT_BUILD_FLAGS ?? "").split(" ").filter(Boolean);

export const limitOfARun = 90_000;
export const limitWithASAN = 240_000;

export const verifiesEachPass = (flags: string[]) =>
  flags.includes("--aot-check=verify-each-pass") || flags.includes("--aot-verify-each-pass");

export async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>, limit?: number) {
  const behindTheFlag = cmd.indexOf("--aot") + 1 || (cmd[1] === "compile" && !cmd.includes("--library") ? 2 : 0);
  if (moreBuildFlags.length && behindTheFlag) cmd = cmd.toSpliced(behindTheFlag, 0, ...moreBuildFlags);
  // Where collections are forced a sweep overwrites dead cells.
  if (env.BUN_JSC_slowPathAllocsBetweenGCs || collectsEveryMillisecond(env))
    env = { BUN_JSC_useZombieMode: "1", ...env };
  // A child that hangs is killed here, and the signal fails the test. A test that merely timed out would leave it running.
  // A build that verifies the IR after every pass takes sixteen times as long as one that does not. --aot-validate checks each built-in module that a program holds: one that starts a Worker holds most of them, one that may load code from disk all.
  const isLong = verifiesEachPass(cmd) || cmd.includes("--aot-validate");
  const timeout =
    limit ??
    (isLong || moreBuildFlags.length || isASAN
      ? limitWithASAN
      : collectsAtEveryAllocation(env)
        ? 120_000
        : limitOfARun);
  const start = performance.now();
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    killSignal: "SIGKILL",
  });
  // A build that is asked to end says what each of its threads is still compiling. One that is killed says nothing.
  const secondsToAnswer = 3;
  const isBuild = behindTheFlag && (cmd.includes("build") || cmd.includes("compile"));
  const answers = !!isBuild && !isWindows;
  using held = endAtMemoryLimit(proc, memoryLimitOfAKnownProgram, answers);
  const asked = answers ? setTimeout(() => proc.kill("SIGTERM"), timeout - secondsToAnswer * 1000) : undefined;
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(asked);
  const milliseconds = Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1000;
  const result = { stdout, stderr, exitCode, signal: proc.signalCode };
  const lasted = performance.now() - start;
  if (held.exceeded)
    console.error(
      [
        `KILLED at its memory limit of ${Math.round(memoryLimitOfAKnownProgram / 2 ** 20)} MB: ${cmd.at(-1)}`,
        ...[held.held].filter(Boolean),
        ...stderr.split("\n").filter(line => line.startsWith("Still ")),
      ].join("\n  "),
    );
  if (
    (proc.signalCode === "SIGKILL" && lasted >= timeout) ||
    (proc.signalCode === "SIGTERM" && asked && lasted >= timeout - secondsToAnswer * 1000)
  ) {
    const stillCompiling = stderr.split("\n").filter(line => line.startsWith("Still "));
    console.error(
      [
        `KILLED at its time limit of ${timeout / 1000} s, with ${Math.round(milliseconds / 1000)} s of processor time used: ${cmd.at(-1)}`,
        ...stillCompiling,
      ].join("\n  "),
    );
    killedWhenTimeWasUp.add(result);
    if (milliseconds >= timeout / 10) atWorkWhenTimeWasUp.add(result);
  }
  return result;
}

export const killedWhenTimeWasUp = new WeakSet<object>();
export const atWorkWhenTimeWasUp = new WeakSet<object>();
export const collectsAtEveryAllocation = (env: Record<string, string | undefined>) =>
  Number(env.BUN_JSC_slowPathAllocsBetweenGCs) <= 7;
export const collectsEveryMillisecond = (env: Record<string, string | undefined>) =>
  env.BUN_JSC_collectContinuously === "1";

// Where the kernel hands a core to a program (systemd-coredump, apport) it starts that program whatever the limit is, but for a limit of one byte, and the process that a signal ended is
// gone only when the program has read it: seconds on a busy machine.
export const withoutCoreDump = (cmd: string[]) =>
  isWindows
    ? cmd
    : [
        "/bin/sh",
        "-c",
        `command -v prlimit > /dev/null 2>&1 && exec prlimit --core=1:1 "$@"; ulimit -c 0 && exec "$@"`,
        "--",
        ...cmd,
      ];
/** For a process that is meant to end by a signal. CI's runner books a report that a passing file leaves on the next file that fails. */
export const withoutCrashReport: Record<string, string> = {
  BUN_ENABLE_CRASH_REPORTING: "0",
  ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }),
};

/** The parts of a run's result that must be equal between two ways of running a program. */
export function told(run: { stdout: string; stderr: string; exitCode: number }) {
  return {
    // A duration that a program measures is not part of its behavior.
    stdout: run.stdout.replace(/ [0-9]+ms$/gm, ""),
    // For an uncaught error, only the line that names the error: the stack frames below it contain file paths, which differ
    // between an executable and the sources. Otherwise everything but the number of the process, with which a warning begins,
    // and the name of the executable in the hint below it.
    stderr:
      run.exitCode === 0
        ? run.stderr
            .replace(/^\(node:[0-9]+\) /gm, "(node) ")
            .replace(/^\(Use `[^`\n]* --trace-warnings /gm, "(Use `bun --trace-warnings ")
        : (run.stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? ""),
    exitCode: run.exitCode,
  };
}

export function built(build: { stderr: string; exitCode: number }) {
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
}

/** The names of the sections of an ELF file of 64 bits. */
export function namesOfSections(path: string) {
  const file = openSync(path, "r");
  const read = (at: number, length: number) => {
    const bytes = Buffer.alloc(length);
    readSync(file, bytes, 0, length, at);
    return bytes;
  };
  try {
    const header = read(0, 64);
    const [size, names] = [header.readUInt16LE(0x3a), header.readUInt16LE(0x3e)];
    const section = read(Number(header.readBigUInt64LE(0x28)) + names * size, size);
    return read(Number(section.readBigUInt64LE(0x18)), Number(section.readBigUInt64LE(0x20)))
      .toString("latin1")
      .split("\0");
  } finally {
    closeSync(file);
  }
}

// Every build writes the Bun that runs it once more, and CI tests bun-profile, which on Linux has its debug information in it:
// three times the bytes of the Bun that ships. A file of many programs builds on a copy without it. The copy lies in the
// temporary directory under a name that tells this Bun from any other. It is made once and found again by every test file,
// process and run, so no test removes it; whoever makes one removes those that nobody has used for a day.
export function withoutDebugInformation(_folder?: string): string[] {
  const strip = isLinux && Bun.which("strip");
  const { ino, size, mtimeMs } = statSync(bunExe());
  // A Bun with AddressSanitizer is large without it too.
  if (!strip || size < 200 * 1024 * 1024 || !namesOfSections(bunExe()).includes(".debug_info")) return [];
  const prefix = "bun-without-debug-information-";
  const copy = join(tmpdir(), `${prefix}${ino}-${size}-${Math.trunc(mtimeMs)}`);
  if (existsSync(copy)) {
    utimesSync(copy, new Date(), new Date());
    return ["--compile-executable-path", copy];
  }
  for (const name of readdirSync(tmpdir())) {
    if (
      name.startsWith(prefix) &&
      Date.now() - (statSync(join(tmpdir(), name), { throwIfNoEntry: false })?.mtimeMs ?? Infinity) >
        24 * 60 * 60 * 1000
    )
      rmSync(join(tmpdir(), name), { force: true });
  }
  const unfinished = `${copy}.${process.pid}`;
  // LeakSanitizer's suppressions (test/leaksan.supp) name functions, so under it the copy keeps its table of symbols.
  const removed = isASAN ? ["--strip-debug"] : [];
  if (
    Bun.spawnSync({ cmd: [strip, ...removed, "-o", unfinished, bunExe()], stdout: "ignore", stderr: "ignore" })
      .exitCode !== 0
  ) {
    rmSync(unfinished, { force: true });
    return [];
  }
  renameSync(unfinished, copy);
  return ["--compile-executable-path", copy];
}
