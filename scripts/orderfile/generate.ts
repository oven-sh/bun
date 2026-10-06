#!/usr/bin/env bun
/**
 * Generates the linker symbol-ordering file that packs bun's startup-hot
 * functions together at the front of `.text`.
 *
 * Why it exists: a `bun -e 'console.log(1)'` only executes ~5k of bun's ~80k
 * functions, but they are scattered over a 50 MB `.text`, and the kernel faults
 * in 16-64 KB around every one of them. Sorting those functions to the front
 * cuts the resident binary pages roughly in half with no change to the binary's
 * size and no change to what the code does.
 *
 * How: a tracer plants a breakpoint (INT3 on x86-64, BRK on arm64) at every
 * function's first instruction and restores it the first time it fires, so it
 * records exactly the functions a run enters. On linux and macOS that is
 * `functrace.c`, a library injected into the traced process; on Windows it is
 * `functrace-windows.c`, which runs the process as its debuggee and does the
 * same from outside. We run a handful of representative workloads, map every
 * recorded address back to its linker-visible name (`readTextSymbols`: nm on
 * the unstripped binary, or on Windows the maps the link wrote beside it — see
 * windows-symbols.ts), and emit those names in first-entry order. Symbols the
 * linker cannot find are ignored, so the file degrades gracefully as code moves.
 *
 * This replaced an earlier page-fault tracer. A page trace lists every function
 * that shares a page with a hot one, so ~5k real entries turned into ~38k
 * names, most of which never ran; the extra names still sort to the front and
 * dilute the hot set. Recording exact entries lists only what ran.
 *
 * One workload runs on a pseudo-terminal (`ptyrun.c`; a pseudo console on
 * Windows): bun's stdio, tty and readline code is a different path on a
 * terminal than on a pipe, and the functions it reaches are a couple of
 * thousand that no other workload touches.
 *
 * The short workloads only reach what a script's first second reaches. A large
 * compiled TUI/CLI application that stays up enters about 13 MB of bun's code —
 * the optimizing JIT tiers, the HTTP client, the module graph of a standalone
 * executable, terminal text measurement, the idle collector — and nearly none
 * of it is on a short script's path, so the order file left it scattered: such
 * an application kept ~35 MB of `.text` resident at its prompt. The app
 * workloads (app/, see app/features.js) are that application in miniature: a
 * compiled multi-module app that runs one small feature per process, traced
 * right after `bun -e` and before the rest. Not on Windows, where the app's
 * pty, shell and unix-socket features do not apply.
 *
 * `--hints=<file>[,<file>]` puts names from symbol lists ahead of everything
 * traced here: an application that traces itself knows its own hot set better
 * than any stand-in. The lists may come from another build of bun, so names
 * that no longer match exactly are matched by normalised name (see
 * `resolveHints`); the rest are dropped.
 *
 * The file is never committed. No CI build traces its own binary: each target's
 * trace-order step (.buildkite/ci.ts) runs this after the build, on a machine
 * that can run the binary, and the next build inherits what it published
 * (scripts/build/ci.ts inheritOrderFile). Locally:
 *
 *   bun run orderfile                      # uses build/release, writes build/release/linker.order
 *   bun run orderfile -- --build-dir=<other build dir>
 *   bun run orderfile -- --hints=<symbol list>[,<symbol list>]
 *
 * Generate against the profile you ship (release is LTO by default): a file
 * generated from a non-LTO build and applied to the LTO link is worth ~1 MB
 * of RSS less (22.6 MB vs 21.6 MB with its own).
 *
 * Linux x86-64/arm64, macOS arm64, and Windows x64/arm64. Linux is the lld
 * `--symbol-ordering-file` input, macOS Apple ld's `-order_file`, Windows
 * lld-link's `/order:@`; all three take one symbol name per line.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selfSignedCertificate } from "./self-signed.ts";
import { readWindowsTextSymbols } from "./windows-symbols.ts";

const STARTS_HEADER_WORDS = 3; // must match functrace.c and functrace-windows.c: magic, version, count
const TRACE_HEADER_WORDS = 5; // magic, version, slide, starts, count
const STARTS_MAGIC = 0x4e55425354525453n; // "STRTSBUN"
const TRACE_MAGIC = 0x4e55424543415254n; // "TRACEBUN"

// `import.meta.dir` is Bun-only; scripts/build/ imports this under node too.
const here = dirname(fileURLToPath(import.meta.url));

/**
 * A trace that resolves almost nothing is worse than no file at all: it silently
 * costs the win while looking like it worked. A real `bun -e` alone lands near
 * ~5k entries, so anything this low means the tracer or the symbol table broke.
 */
const MIN_FUNCTIONS = 4000;

/**
 * A workload that blows through this is hung — an interactive one waiting on an
 * end-of-input that never comes, say — and a release build must not hang with it.
 */
const WORKLOAD_TIMEOUT_MS = 120_000;

/** Typed into cli-fixture.js. `quit` is what makes it exit. */
const CLI_INPUT = "world\none\ntwo\nquit\n";

interface Workload {
  name: string;
  /** What to run the arguments with. Defaults to the binary under trace; an executable compiled from it has the same code at the same addresses. */
  exe?: string;
  args: string[];
  /** Working directory for the traced process. */
  cwd?: string;
  /** Typed into stdin; on a terminal it arrives as keystrokes. */
  input?: string;
  /** Run on a pseudo-terminal rather than pipes (see ptyrun.c). */
  tty?: boolean;
  env?: Record<string, string>;
}

/** Many small workloads, run several at a time and reported as one line. */
interface WorkloadGroup {
  group: string;
  workloads: Workload[];
  /** Names of the workloads the order file is not worth publishing without. */
  required: string[];
}

export interface RunOptions {
  env?: Record<string, string | undefined> | undefined;
  cwd?: string | undefined;
  input?: string | undefined;
  timeout?: number | undefined;
  /** How the command is named in errors. Defaults to the executable. */
  label?: string | undefined;
  /** Stops the command and its process group when it aborts (runCommandAsync only). */
  signal?: AbortSignal | undefined;
}

/**
 * Runs a command to completion, throwing if it could not be spawned. Exported so
 * a test can drive it under node: bun's spawnSync delivers `input` whatever stdin
 * is, so the wiring below only ever breaks on CI, which builds under node.
 */
export function runCommand(cmd: string[], options: RunOptions = {}) {
  const r = spawnSync(cmd[0]!, cmd.slice(1), {
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
    input: options.input,
    timeout: options.timeout,
    // Only a pipe carries `input`: node drops it when stdin is "ignore", and
    // then an interactive workload reads nothing and waits forever for a line.
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 1 << 29, // nm prints ~10 MB of symbols
  });
  // A timeout arrives here too: spawnSync reports it as an ETIMEDOUT error.
  if (r.error) throw new Error(`${options.label ?? cmd[0]}: ${r.error.message}`, { cause: r.error });
  return r;
}

/** How long a command that was told to stop (SIGTERM) has before it is killed. */
export const KILL_GRACE_MS = 2_000;

const ENDING_SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;

/**
 * Which of `signals` (by number) this process ignores, asked of the process
 * itself: sigaction(signal, NULL, &current) through bun:ffi. Nothing outside it
 * can say: a child cannot, because bun's spawn resets the dispositions a child
 * inherits. `undefined` where it cannot be asked (node, which has no bun:ffi and
 * resets what it inherits anyway; a libc that is not there).
 */
export async function sigactionIgnored(signals: number[]): Promise<Set<number> | undefined> {
  try {
    // Not a literal: node and tsc would both look for the module.
    const ffi = "bun:ffi";
    const { dlopen, ptr } = await import(ffi);
    const libc = dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", {
      sigaction: { args: ["i32", "ptr", "ptr"], returns: "i32" },
    });
    try {
      const ignored = new Set<number>();
      for (const signal of signals) {
        // struct sigaction starts with the handler on both (16 bytes on darwin, 152 with glibc).
        const current = Buffer.alloc(256);
        if (libc.symbols.sigaction(signal, null, ptr(current)) !== 0) return undefined;
        const SIG_IGN = 1;
        if (current.readUInt32LE(0) === SIG_IGN && current.readUInt32LE(4) === 0) ignored.add(signal);
      }
      return ignored;
    } finally {
      libc.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * The ending signals this process was started ignoring (under nohup, as a
 * background job of a script): a listener would make them end it after all.
 * The process is asked first (`sigactionIgnored`); where it cannot be (musl,
 * node) linux still says in /proc/self/status (SigIgn). With neither, none
 * counts as ignored, so every ending signal is held: removing the scratch
 * directory matters more than honouring a nohup nobody can see. Under node none
 * ever does: it resets what it inherits when it starts.
 */
async function ignoredEndingSignals(): Promise<Set<string>> {
  let ignored = process.platform === "win32" ? undefined : await sigactionIgnored(Object.values(ENDING_SIGNALS));
  if (!ignored && process.platform === "linux") {
    try {
      const hex = /^SigIgn:\s*([0-9a-f]+)$/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1];
      // The ending signals are all among the first 32.
      const mask = hex ? parseInt(hex.slice(-8), 16) : 0;
      ignored = new Set(Object.values(ENDING_SIGNALS).filter(number => (mask >>> (number - 1)) & 1));
    } catch {
      // No /proc: none counts as ignored.
    }
  }
  const names = Object.entries(ENDING_SIGNALS).filter(([, number]) => ignored?.has(number));
  return new Set(names.map(([name]) => name));
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

/**
 * Runs `work` with a scratch directory that is gone afterwards, also when a
 * signal ends the process: the directory holds a copy of bun. A signal is held
 * while `work` runs; it aborts `interrupted` (which `work` passes on to whatever
 * it is waiting for, and checks between synchronous steps), and once the
 * directory is removed the process ends the way the signal would have ended it.
 * Inside another withScratch that is left to the outer one, whose directory is
 * still there.
 */
let scratchDepth = 0;
let startedIgnoring: Promise<Set<string>> | undefined;
export async function withScratch<T>(
  prefix: string,
  work: (scratch: string, interrupted: AbortSignal) => T | Promise<T>,
): Promise<T> {
  // Asked once, before this process has added a listener of its own: that replaces the disposition.
  const ignored = await (startedIgnoring ??= ignoredEndingSignals());
  const held = (Object.keys(ENDING_SIGNALS) as NodeJS.Signals[]).filter(name => !ignored.has(name));
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const controller = new AbortController();
  let ending: NodeJS.Signals | undefined;
  const hold = (signal: NodeJS.Signals) => {
    ending ??= signal;
    controller.abort(new Error(`interrupted by ${signal}`));
  };
  for (const name of held) process.on(name, hold);
  scratchDepth++;
  try {
    return await work(scratch, controller.signal);
  } finally {
    scratchDepth--;
    try {
      rmSync(scratch, { recursive: true, force: true });
    } finally {
      // A signal that arrived while a synchronous command had the thread is only delivered on the next turn.
      await nextTurn();
      for (const name of held) process.removeListener(name, hold);
      if (ending && scratchDepth === 0) {
        process.kill(process.pid, ending);
        await new Promise(resolve => setTimeout(resolve, 1_000)); // until it lands
      }
    }
  }
}

/** Between two synchronous steps, neither of which could be interrupted: gives a held signal its turn. */
export async function checkpoint(interrupted: AbortSignal): Promise<void> {
  await nextTurn();
  interrupted.throwIfAborted();
}

/**
 * `runCommand` without blocking, for workloads traced several at a time. Stdin
 * is a pipe that stays open until the command exits: on a terminal (ptyrun.c)
 * an end of input is typed as ^D, which an application sitting at its prompt
 * never sees.
 *
 * The command leads a process group of its own, and a timeout or an abort stops
 * that group: SIGTERM, which ptyrun passes on to its child's group as SIGKILL,
 * then SIGKILL. A stopped command is settled when it exits rather than when its
 * output closes, which a descendant holding the pipe can delay for as long as
 * it lives.
 */
export function runCommandAsync(
  cmd: string[],
  options: RunOptions = {},
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const label = options.label ?? cmd[0]!;
    const windows = process.platform === "win32";
    const child = spawn(cmd[0]!, cmd.slice(1), {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: !windows,
    });

    let stopped: string | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (windows || child.pid === undefined) child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    };
    const stop = (why: string) => {
      if (stopped !== undefined) return;
      stopped = why;
      signalGroup("SIGTERM");
      escalation = setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
    };
    // On a terminal the command's stderr arrives on stdout too. Only the end of
    // it is kept: it is there for an error message.
    let output = "";
    const keep = (chunk: Buffer) => (output = (output + chunk).slice(-2000));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);

    const timer =
      options.timeout === undefined
        ? undefined
        : setTimeout(() => stop(`timed out after ${options.timeout! / 1000} s`), options.timeout);
    const abort = () => stop("stopped with the rest of its group");
    options.signal?.addEventListener("abort", abort);
    const release = () => {
      clearTimeout(timer);
      clearTimeout(escalation);
      options.signal?.removeEventListener("abort", abort);
    };

    // Goes by what the command did, not by what was asked of it: one that
    // finished just as it was being stopped still finished.
    const settle = (status: number | null, signal: NodeJS.Signals | null) => {
      release();
      if (status === 0) resolve({ status, output });
      else if (stopped !== undefined) reject(new Error(`${label}: ${stopped}\n${output}`));
      else if (signal) reject(new Error(`${label}: killed by ${signal}\n${output}`));
      else resolve({ status, output });
    };
    child.on("error", error => {
      release();
      reject(new Error(`${label}: ${error.message}`));
    });
    child.on("exit", (status, signal) => {
      if (stopped === undefined) return;
      signalGroup("SIGKILL"); // what the command left behind
      settle(status, signal);
    });
    child.on("close", settle);
    child.stdin.on("error", () => {}); // the command may exit without reading
    if (options.input !== undefined) child.stdin.write(options.input);
    if (options.signal?.aborted) abort();
  });
}

export interface GenerateOptions {
  /** Build directory holding the unstripped binary. */
  buildDir: string;
  /**
   * Unstripped binary to trace, without the `.exe` Windows adds. Defaults to
   * `bun-profile`; an assertions build names it differently.
   */
  exeName?: string;
  /** Where to write the order file. Defaults to `<buildDir>/linker.order`. */
  outPath?: string;
  /** Fail if fewer than this many functions were traced. */
  minFunctions?: number;
  /** Symbol lists to place ahead of everything traced, one name per line (`#` starts a comment). */
  hints?: string[];
  /** Print per-workload progress. */
  verbose?: boolean;
}

/**
 * Linker-visible function names by link-time address, for every function in
 * the binary. Multiple names can share one address (aliases, and functions the
 * linker folded together), and the order file must list every name the linker
 * might know a function by, so nothing is collapsed here. Names are taken
 * exactly as the tool prints them: on macOS that includes the C leading
 * underscore, which is also what `-order_file` expects.
 *
 * ELF and Mach-O binaries carry their symbol table, so nm reads it off the
 * binary. A PE does not, so a Windows binary is read through the maps the link
 * wrote next to it (windows-symbols.ts).
 */
export function readTextSymbols(exe: string): Map<number, string[]> {
  if (exe.toLowerCase().endsWith(".exe")) return readWindowsTextSymbols(exe);

  const symbols = new Map<number, string[]>();
  // $NM, else whichever nm is installed. Bare, with no GNU-only long options:
  // the regex is the defined-text-symbol filter, and nothing depends on order.
  const tools = [process.env.NM, "llvm-nm", "nm"].filter((tool): tool is string => !!tool);
  const failures: string[] = [];
  let listing: string | undefined;
  for (const nm of tools) {
    let r: ReturnType<typeof runCommand>;
    try {
      r = runCommand([nm, exe]);
    } catch (error) {
      failures.push((error as Error).message); // not installed
      continue;
    }
    if (r.status === 0) {
      listing = r.stdout.toString();
      break;
    }
    failures.push(`${nm} exited ${r.status}: ${r.stderr.toString().trim()}`);
  }
  if (listing === undefined) throw new Error(`cannot list ${exe}'s symbols:\n${failures.join("\n")}`);

  for (const line of listing.split("\n")) {
    const m = /^([0-9a-f]+) [tT] (\S+)$/.exec(line);
    if (!m) continue;
    const address = parseInt(m[1]!, 16);
    const names = symbols.get(address);
    if (names) names.push(m[2]!);
    else symbols.set(address, [m[2]!]);
  }
  if (symbols.size === 0) throw new Error(`nm listed no text symbols — is ${exe} stripped?`);
  return symbols;
}

/** Write function starts for the tracer: u64 magic, version, count, addresses. */
export function writeStarts(path: string, addresses: number[]): void {
  const buffer = new ArrayBuffer((STARTS_HEADER_WORDS + addresses.length) * 8);
  const words = new BigUint64Array(buffer);
  words[0] = STARTS_MAGIC;
  words[1] = 1n;
  words[2] = BigInt(addresses.length);
  for (let i = 0; i < addresses.length; i++) words[STARTS_HEADER_WORDS + i] = BigInt(addresses[i]!);
  writeFileSync(path, new Uint8Array(buffer));
}

/** Read a trace the tracer wrote: first-entry addresses, slide already removed. */
export function readTrace(path: string, name: string): number[] {
  const raw = readFileSync(path);
  if (raw.byteLength < TRACE_HEADER_WORDS * 8) throw new Error(`workload "${name}" wrote a truncated trace`);
  const header = new BigUint64Array(raw.buffer, raw.byteOffset, TRACE_HEADER_WORDS);
  if (header[0] !== TRACE_MAGIC || header[1] !== 1n) throw new Error(`workload "${name}" wrote an invalid trace`);
  // The tracer counts every first entry but has room for one per start, and the
  // file may have been cut short: read what is there.
  const count = Math.min(Number(header[4]), Number(header[3]), Math.floor(raw.byteLength / 8) - TRACE_HEADER_WORDS);
  if (count <= 0) throw new Error(`workload "${name}" recorded no entries — is the tracer loading?`);
  const body = new BigUint64Array(raw.buffer, raw.byteOffset + TRACE_HEADER_WORDS * 8, count);
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = Number(body[i]);
  return out;
}

/** A built tracer: how to run one workload under it. */
interface Tracer {
  /** The linker option the resulting file is for, named in its header. */
  linker: string;
  /** The command that runs `exe` with the workload's arguments under trace, and the environment that arms it. */
  launch(workload: Workload, exe: string): { cmd: string[]; env: Record<string, string> };
}

/**
 * Builds functrace.c as a library. Returns its path and the loader variable
 * that injects it: LD_PRELOAD, or DYLD_INSERT_LIBRARIES on macOS.
 */
export function buildTracerLibrary(scratch: string): { library: string; preloadVar: string } {
  const darwin = process.platform === "darwin";
  const library = join(scratch, darwin ? "functrace.dylib" : "functrace.so");
  const cc = process.env.CC || "cc";
  const build = runCommand(
    darwin
      ? [cc, "-O2", "-dynamiclib", "-fPIC", "-o", library, join(here, "functrace.c")]
      : [cc, "-O2", "-shared", "-fPIC", "-o", library, join(here, "functrace.c"), "-ldl", "-lpthread"],
  );
  if (build.status !== 0) throw new Error(`failed to build the tracer with ${cc}\n${build.stderr}`);
  return { library, preloadVar: darwin ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD" };
}

/**
 * functrace.c rides into the traced process on the loader's preload variable.
 * The terminal workload runs under ptyrun.c, which is then the traced process's
 * parent, so it is handed the preload to pass down rather than loading it itself.
 */
function buildUnixTracer(scratch: string): Tracer {
  const darwin = process.platform === "darwin";
  const { library: tracer, preloadVar } = buildTracerLibrary(scratch);
  const ptyrun = join(scratch, "ptyrun");
  const cc = process.env.CC || "cc";
  const pty = runCommand([cc, "-O2", "-o", ptyrun, join(here, "ptyrun.c"), ...(darwin ? [] : ["-lutil"])]);
  if (pty.status !== 0) throw new Error(`failed to build the pty runner with ${cc}\n${pty.stderr}`);

  return {
    linker: darwin ? "ld -order_file" : "lld --symbol-ordering-file",
    launch: (workload, exe) =>
      workload.tty
        ? { cmd: [ptyrun, exe, ...workload.args], env: { PTYRUN_PRELOAD: tracer } }
        : { cmd: [exe, ...workload.args], env: { [preloadVar]: tracer } },
  };
}

/**
 * functrace-windows.c is a debugger, so it runs the workload itself, and puts
 * it on a pseudo console when asked to. Built with clang-cl when there is one
 * (LLVM is on every bun dev machine and CI image), else with cl, which needs a
 * Visual Studio developer shell; $CC names one explicitly.
 */
function buildWindowsTracer(scratch: string): Tracer {
  const tracer = join(scratch, "functrace.exe");
  const failures: string[] = [];
  for (const cc of process.env.CC ? [process.env.CC] : ["clang-cl", "cl"]) {
    // clang-cl links with whatever `link` is first on PATH, which on a machine
    // with git is as likely to be coreutils' as MSVC's; lld-link ships beside it.
    const linker = /clang-cl/i.test(basename(cc)) ? ["-fuse-ld=lld"] : [];
    let build: ReturnType<typeof runCommand>;
    try {
      build = runCommand([cc, "/nologo", "/O2", ...linker, join(here, "functrace-windows.c"), `/Fe:${tracer}`], {
        cwd: scratch, // cl drops the .obj in the working directory
      });
    } catch (error) {
      failures.push((error as Error).message); // not installed
      continue;
    }
    if (build.status === 0) break;
    failures.push(`${cc} exited ${build.status}:\n${build.stdout}${build.stderr}`); // cl reports errors on stdout
  }
  if (!existsSync(tracer)) {
    throw new Error(`failed to build the tracer — needs clang-cl, or cl in a developer shell:\n${failures.join("\n")}`);
  }
  return {
    linker: "lld-link /order",
    launch: (workload, exe) => {
      const env: Record<string, string> = {};
      if (workload.tty) env.BUN_FUNCTRACE_TTY = "1";
      return { cmd: [tracer, exe, ...workload.args], env };
    },
  };
}

const CLONE_SUFFIXES = /(\.llvm\.\d+|\.cold(\.\d+)?|\.isra\.\d+|\.part\.\d+|\.constprop\.\d+|\.\d+)+$/;

/** A name without the suffixes the optimizer gives a function's clones (`.llvm.123`, `.cold`, `.isra.0`, …), which differ from build to build. */
const withoutCloneSuffix = (name: string) => name.replace(CLONE_SUFFIXES, "");

/** Mach-O puts an underscore before every C-level name: `malloc` is `_malloc` there, `_ZN3JSC…` is `__ZN3JSC…`. */
export type ObjectFormat = "elf" | "macho";

export const hostObjectFormat: ObjectFormat = process.platform === "darwin" ? "macho" : "elf";

export interface HintList {
  names: string[];
  format: ObjectFormat;
}

/**
 * A symbol list, and the object format its names are spelled for: a `# format:`
 * line says (hints.ts writes one), and a list without one is taken to be
 * spelled for the link it is given to.
 */
export function readHintList(path: string, fallback: ObjectFormat = hostObjectFormat): HintList {
  const format = /^#\s*format:\s*(elf|macho)\s*$/m.exec(readFileSync(path, "utf8"))?.[1] as ObjectFormat | undefined;
  return { names: readNameList(path), format: format ?? fallback };
}

/** The list's names as `format` spells them. A Mach-O name with no underscore has no ELF spelling and stays as it is. */
export function hintNames(list: HintList, format: ObjectFormat): string[] {
  if (list.format === format) return list.names;
  return list.names.map(name => (format === "macho" ? `_${name}` : name.replace(/^_/, "")));
}

const DEMANGLERS = [process.env.CXXFILT, "llvm-cxxfilt", "c++filt"].filter((tool): tool is string => !!tool);

/**
 * Demangles Rust names, for comparing them across builds: the mangled form
 * carries a per-build hash for every crate (`Cs7kMPyjk15S4_15bun_collections`),
 * and the demangled form either omits it (llvm-cxxfilt) or brackets it
 * (`bun_collections[55704760041dd906]`, GNU c++filt), which is stripped here.
 * With no working tool the names come back unchanged, and only names from the
 * same build of a crate match: fewer hints, not a wrong order file.
 */
export function demangleRust(input: string[], tools: string[] = DEMANGLERS): string[] {
  for (const tool of tools) {
    let failure: string;
    try {
      // -n: the tools' defaults about a leading underscore differ by host.
      const r = runCommand([tool, "-n"], { input: input.join("\n") + "\n" });
      const lines = r.stdout.toString().split("\n");
      if (r.status === 0 && lines.length >= input.length) {
        return lines.slice(0, input.length).map(line => line.replace(/\[[0-9a-f]{8,}\]/g, ""));
      }
      failure = `${tool} exited ${r.status} after ${lines.length - 1} of ${input.length} names\n${r.stderr}`;
    } catch (error) {
      if (((error as Error).cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue; // not installed
      failure = (error as Error).message;
    }
    console.warn(`warning: ${failure.trim()}`);
  }
  console.warn(
    `warning: no working demangler (${tools.join(", ")}): Rust hints only match names with the same crate hashes, ` +
      "so most of those from another build of bun are dropped",
  );
  return input;
}

export interface ResolvedHints {
  /** Names of the current build, in hint order. */
  names: string[];
  listed: number;
  exact: number;
  normalized: number;
}

/**
 * Maps hint names onto the current build's symbols; both are spelled for the
 * same object format (`hintNames`). A name the build still has is taken as it
 * is. One it does not have is matched without its clone suffix, and, for a Rust
 * name, by its demangled form; every current symbol that matches is taken,
 * since they are clones of one function and which one runs is not knowable
 * from here. Names that match nothing are dropped, as the linker drops them.
 * The demangler only runs if a Rust name is left unmatched, and only over the
 * Rust names.
 */
export function resolveHints(
  hints: string[],
  current: Iterable<string>,
  demangle: (names: string[]) => string[] = demangleRust,
): ResolvedHints {
  const have = new Set(current);
  const index = (names: string[], keys: string[]) => {
    const map = new Map<string, string[]>();
    for (const [i, name] of names.entries()) {
      const list = map.get(keys[i]!);
      if (list) list.push(name);
      else map.set(keys[i]!, [name]);
    }
    return map;
  };

  const currentNames = [...have];
  const byName = index(currentNames, currentNames.map(withoutCloneSuffix));
  /** A Rust (v0) mangled name as the demanglers take it: without its clone suffix or Mach-O's underscore. */
  const rustName = (name: string) => /^_?(_R.*)$/.exec(withoutCloneSuffix(name))?.[1];

  const unmatchedRust = hints.filter(
    hint => !have.has(hint) && rustName(hint) && !byName.has(withoutCloneSuffix(hint)),
  );
  let byDemangled = new Map<string, string[]>();
  const demangledHints = new Map<string, string>();
  if (unmatchedRust.length) {
    const currentRust = currentNames.filter(rustName);
    const demangled = demangle([...currentRust, ...unmatchedRust].map(name => rustName(name)!));
    byDemangled = index(currentRust, demangled.slice(0, currentRust.length));
    for (const [i, hint] of unmatchedRust.entries()) demangledHints.set(hint, demangled[currentRust.length + i]!);
  }

  const resolved: ResolvedHints = { names: [], listed: hints.length, exact: 0, normalized: 0 };
  const seen = new Set<string>();
  for (const hint of hints) {
    const matches = have.has(hint)
      ? [hint]
      : (byName.get(withoutCloneSuffix(hint)) ?? byDemangled.get(demangledHints.get(hint)!) ?? []);
    if (!matches.length) continue;
    if (have.has(hint)) resolved.exact++;
    else resolved.normalized++;
    for (const name of matches) {
      if (seen.has(name)) continue;
      seen.add(name);
      resolved.names.push(name);
    }
  }
  return resolved;
}

interface CodeRange {
  /** Link-time address. */
  address: bigint;
  /** Where its bytes are in the file. */
  offset: number;
  size: number;
}

const readAt = (fd: number, offset: number, size: number): Buffer => {
  const buffer = Buffer.alloc(size);
  return buffer.subarray(0, readSync(fd, buffer, 0, size, offset));
};

/**
 * Where an executable's code is: the executable PT_LOAD segments of a 64-bit
 * ELF, or `__TEXT,__text` of a thin 64-bit Mach-O. Read through the program
 * headers and load commands, which no tool can strip and the loader itself
 * goes by.
 */
function codeRanges(fd: number, path: string): CodeRange[] {
  const header = readAt(fd, 0, 64);
  const ranges: CodeRange[] = [];
  try {
    if (header.readUInt32BE(0) === 0x7f454c46 && header[4] === 2 && header[5] === 1) {
      const [phoff, phentsize, phnum] = [Number(header.readBigUInt64LE(32)), header.readUInt16LE(54), header.readUInt16LE(56)]; // prettier-ignore
      const table = readAt(fd, phoff, phentsize * phnum);
      for (let at = 0; at < phentsize * phnum; at += phentsize) {
        const [type, flags] = [table.readUInt32LE(at), table.readUInt32LE(at + 4)];
        if (type !== 1 /* PT_LOAD */ || !(flags & 1) /* PF_X */) continue;
        ranges.push({
          address: table.readBigUInt64LE(at + 16),
          offset: Number(table.readBigUInt64LE(at + 8)),
          size: Number(table.readBigUInt64LE(at + 32)),
        });
      }
    } else if (header.readUInt32LE(0) === 0xfeedfacf) {
      const commands = readAt(fd, 32, header.readUInt32LE(20));
      for (let at = 0; at < commands.length; at += Math.max(8, commands.readUInt32LE(at + 4))) {
        if (commands.readUInt32LE(at) !== 0x19 /* LC_SEGMENT_64 */) continue;
        const sections = commands.readUInt32LE(at + 64);
        for (let section = at + 72; section < at + 72 + sections * 80; section += 80) {
          const name = (from: number) => commands.toString("latin1", from, from + 16).replace(/\0+$/, "");
          if (name(section) !== "__text" || name(section + 16) !== "__TEXT") continue;
          ranges.push({
            address: commands.readBigUInt64LE(section + 32),
            offset: commands.readUInt32LE(section + 48),
            size: Number(commands.readBigUInt64LE(section + 40)),
          });
        }
      }
    } else if (header.readUInt32BE(0) === 0xcafebabe) {
      throw new Error(`${path} is a universal Mach-O; the tracer follows one architecture (lipo -thin)`);
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error; // a header that points past the end of the file
  }
  if (!ranges.length) throw new Error(`cannot find the code of ${path}: not a 64-bit ELF or Mach-O executable?`);
  return ranges;
}

/**
 * Whether `exe` carries the code of `profile`: the same bytes at the same
 * link-time addresses. The starts are addresses in the profile, and a
 * breakpoint planted at one of them in any other build lands mid-instruction.
 * Stripping and `bun build --compile` both leave the code as it was.
 */
export function sameCode(profile: string, exe: string): boolean {
  const [a, b] = [openSync(profile, "r"), openSync(exe, "r")];
  try {
    const [ours, theirs] = [codeRanges(a, profile), codeRanges(b, exe)];
    if (ours.length !== theirs.length) return false;
    for (const [i, range] of ours.entries()) {
      const other = theirs[i]!;
      if (range.address !== other.address || range.size !== other.size) return false;
      const step = 1 << 22;
      for (let done = 0; done < range.size; done += step) {
        const size = Math.min(step, range.size - done);
        const bytes = readAt(a, range.offset + done, size);
        if (bytes.length !== size || !bytes.equals(readAt(b, other.offset + done, size))) return false;
      }
    }
    return true;
  } finally {
    closeSync(a);
    closeSync(b);
  }
}

/**
 * Appends to `order` every name at `addresses` that is not in it yet. Returns
 * how many names that added, and how many addresses had no name at all.
 */
export function appendNames(
  order: string[],
  seen: Set<string>,
  symbols: Map<number, string[]>,
  addresses: Iterable<number>,
): { added: number; unresolved: number } {
  const before = order.length;
  let unresolved = 0;
  for (const address of addresses) {
    const names = symbols.get(address);
    if (!names) {
      unresolved++;
      continue;
    }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      order.push(name);
    }
  }
  return { added: order.length - before, unresolved };
}

/** One name per line; `#` starts a comment, as in the order file itself. */
export function readNameList(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

/**
 * Empty reads as unset. The workloads talk to servers on 127.0.0.1, and one app
 * feature names a proxy of its own: a proxy the machine has configured would
 * take the direct requests, and its NO_PROXY would take that feature off its proxy.
 */
export const NO_PROXY_SETTINGS: Record<string, string> = Object.fromEntries(
  ["http_proxy", "https_proxy", "all_proxy", "no_proxy"].flatMap(name => [
    [name, ""],
    [name.toUpperCase(), ""],
  ]),
);

/** app/features.txt: the features in traced order; a `!` marks one the group is required to trace. */
export function readFeatures(path: string): { names: string[]; required: string[] } {
  const listed = readNameList(path);
  const names = listed.map(name => name.replace(/^!/, ""));
  return { names, required: names.filter((_, i) => listed[i]!.startsWith("!")) };
}

/**
 * Builds the app the app workloads run (app/scaffold.js) into one executable
 * with the binary under trace, and returns a workload per feature, in the
 * order app/features.txt gives. Each is a run of that executable on a terminal
 * with one feature selected, so what the order file takes from a run is that
 * feature's code and whatever earlier runs had not already entered.
 */
function appWorkloads(bunProfile: string, scratch: string): WorkloadGroup {
  const source = join(here, "app");
  const tree = join(scratch, "app");
  const data = join(scratch, "app-data");
  const temp = join(scratch, "app-tmp");
  mkdirSync(data);
  mkdirSync(temp);
  // What the local TLS server presents and its clients pin, and a second CA for a client's trust store.
  const { cert, key } = selfSignedCertificate("rsa");
  writeFileSync(join(data, "cert.pem"), cert);
  writeFileSync(join(data, "key.pem"), key);
  writeFileSync(join(data, "eccert.pem"), selfSignedCertificate("ec").cert);

  const scaffold = runCommand([bunProfile, join(source, "scaffold.js"), tree], { label: "app scaffold" });
  if (scaffold.status !== 0) throw new Error(`could not write the app workloads' source\n${scaffold.stderr}`);
  const exe = join(scratch, "orderfile-app");
  const embedded = readdirSync(join(tree, "src", "rt")).map(file => join("src", "rt", file));
  const build = runCommand(
    [
      bunProfile,
      "build",
      "--compile",
      "--bytecode",
      "--splitting",
      "--format=esm",
      "--target=bun",
      "--minify",
      // A long-running application raises the JIT thresholds while it starts and lowers them once it is up (tui.js).
      "--compile-jit-policy=4",
      // Defines handed to the executable's runtime transpiler are parsed on every start.
      `--compile-exec-argv=--define=ORDERFILE_APP:true --define=ORDERFILE_TRACED:true --define=process.env.ORDERFILE_MODE:"compiled"`,
      join("src", "main.js"),
      ...embedded,
      "--outfile",
      exe,
    ],
    { cwd: tree, label: "bun build --compile (app workloads)", timeout: WORKLOAD_TIMEOUT_MS },
  );
  if (build.status !== 0) throw new Error(`could not compile the app workloads\n${build.stdout}${build.stderr}`);
  if (!sameCode(bunProfile, exe)) {
    throw new Error(`bun build --compile did not leave ${basename(bunProfile)}'s code where the symbols say it is`);
  }

  const features = readFeatures(join(source, "features.txt"));
  const env = { ORDERFILE_APP_DATA: data, TMPDIR: temp, TERM: "xterm-256color" };
  const name = (feature: string) => `app ${feature}`;
  return {
    group: "app",
    required: ["startup", ...features.required].map(name),
    workloads: ["startup", ...features.names].map(feature => ({
      name: name(feature),
      exe,
      args: [],
      // Not wherever the generator was started: a bunfig.toml or package.json there would be read on every start.
      cwd: temp,
      tty: true,
      // The terminal features read keys; everything else ignores its stdin.
      ...(feature.startsWith("tui_") ? { input: "hello\r" } : {}),
      env: { ...env, ORDERFILE_FEATURES: feature },
    })),
  };
}

/** The longest of a group's runs takes ~15 s under trace (the app's idle feature waits 11.5 s). */
const GROUP_WORKLOAD_TIMEOUT_MS = 60_000;

/** For a whole group (~30 s on a developer's machine). CI kills the trace-order step at 15 minutes without a word (.buildkite/ci.ts). */
const GROUP_TIMEOUT_MS = 8 * 60_000;

/** More failures than this share of a group means the group is broken, not that a feature had a bad day. */
const MAX_GROUP_FAILURES = 0.1;

/** A group's runs mostly wait (on timers, a terminal, a local server), so more of them than cores is fine; the cap keeps JIT-heavy runs from starving each other's compiler threads. */
const GROUP_CONCURRENCY = Math.max(2, Math.min(8, availableParallelism()));

export interface GroupPolicy {
  concurrency: number;
  /** Tried twice, and the group fails if the second try fails too. */
  required: ReadonlySet<string>;
  /** How many of the other runs may fail before the group does. */
  maxFailures: number;
  /** For the whole group, in milliseconds. */
  timeoutMs: number;
  /** Ends the group with its reason when it aborts. */
  interrupted?: AbortSignal;
}

export interface GroupResult<T> {
  /** By index; `undefined` where the run failed. */
  results: (T | undefined)[];
  failures: { name: string; message: string }[];
}

/**
 * One of hundreds of small runs failing costs the order file a few functions,
 * and failing the release's order file over it would cost all of them. So a
 * failure is tolerated unless the run is required, too many have failed, or the
 * group is out of time: then nothing more starts, the signal stops what is
 * running, and the group throws.
 */
export async function runGroup<T>(
  group: string,
  names: string[],
  run: (index: number, signal: AbortSignal) => Promise<T>,
  policy: GroupPolicy,
): Promise<GroupResult<T>> {
  const unknown = [...policy.required].filter(name => !names.includes(name));
  if (unknown.length) throw new Error(`the ${group} workloads require ${unknown.join(", ")}, which they do not have`);

  const results: (T | undefined)[] = new Array(names.length).fill(undefined);
  const failures: GroupResult<T>["failures"] = [];
  const controller = new AbortController();
  let fatal: Error | undefined;
  const stop = (error: Error) => {
    fatal ??= error;
    controller.abort();
  };
  let finished = 0;
  const deadline = setTimeout(
    () =>
      stop(
        new Error(
          `the ${group} workloads did not finish in ${policy.timeoutMs / 1000} s ` +
            `(${finished} of ${names.length} had)` +
            (failures.length ? `; the first failure:\n${failures[0]!.message}` : ""),
        ),
      ),
    policy.timeoutMs,
  );

  const interrupt = () => stop(policy.interrupted!.reason);
  policy.interrupted?.addEventListener("abort", interrupt);
  if (policy.interrupted?.aborted) interrupt();

  let next = 0;
  const worker = async () => {
    while (!controller.signal.aborted && next < names.length) {
      const i = next++;
      const name = names[i]!;
      const required = policy.required.has(name);
      let failure: string | undefined;
      for (let attempt = 1; attempt <= (required ? 2 : 1) && !controller.signal.aborted; attempt++) {
        try {
          results[i] = await run(i, controller.signal);
          // Said even though it passed: a required run that fails every other time is news.
          if (failure !== undefined) console.warn(`warning: ${name} passed on its second try; the first:\n${failure}`);
          failure = undefined;
          break;
        } catch (error) {
          failure = (error as Error).message;
        }
      }
      // A run the group stopped on its way out did not fail on its own account.
      if (controller.signal.aborted) return;
      finished++;
      if (failure === undefined) continue;
      failures.push({ name, message: failure });
      if (required) {
        stop(
          new Error(`${name} failed twice, and the ${group} workloads are not worth tracing without it:\n${failure}`),
        );
      } else if (failures.length > policy.maxFailures) {
        stop(
          new Error(
            `${failures.length} of the ${names.length} ${group} workloads failed ` +
              `(${failures.map(f => f.name).join(", ")}); the first:\n${failures[0]!.message}`,
          ),
        );
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: policy.concurrency }, worker));
  } finally {
    clearTimeout(deadline);
    policy.interrupted?.removeEventListener("abort", interrupt);
  }
  if (fatal) throw fatal;
  return { results, failures };
}

export async function generateOrderFile(options: GenerateOptions): Promise<{ count: number; outPath: string }> {
  const buildDir = resolve(options.buildDir);
  const outPath = resolve(options.outPath ?? join(buildDir, "linker.order"));
  const minFunctions = options.minFunctions ?? MIN_FUNCTIONS;
  const log = (message: string) => options.verbose && console.log(message);

  const windows = process.platform === "win32";
  if (process.platform !== "linux" && !windows && !(process.platform === "darwin" && process.arch === "arm64")) {
    throw new Error("the order file tracer builds on linux x86-64/arm64, macOS arm64, or Windows x64/arm64");
  }

  // The unstripped binary: its symbols are what map addresses back to names.
  const bunProfile = join(buildDir, (options.exeName ?? "bun-profile") + (windows ? ".exe" : ""));
  if (!existsSync(bunProfile)) {
    throw new Error(`${bunProfile} not found — build it first (bun run build:release)`);
  }

  return withScratch("bun-orderfile-", async (scratch, interrupted) => {
    const tracer = windows ? buildWindowsTracer(scratch) : buildUnixTracer(scratch);
    await checkpoint(interrupted);

    // ── Symbol table and function starts ──────────────────────────────────────
    const symbols = readTextSymbols(bunProfile);
    const startsPath = join(scratch, "starts.bin");
    writeStarts(
      startsPath,
      [...symbols.keys()].sort((a, b) => a - b),
    );

    // ── Representative workloads ──────────────────────────────────────────────
    // Order matters: earlier workloads get the densest placement, so the plain
    // runtime startup path comes first.
    const fixtures = join(scratch, "fixtures");
    mkdirSync(join(fixtures, "tests"), { recursive: true });
    writeFileSync(
      join(fixtures, "hello.ts"),
      `const greet = (name: string): string => \`hi \${name}\`;\nconsole.log(greet("world"));\n`,
    );
    writeFileSync(
      join(fixtures, "server.js"),
      `const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });\n` +
        `for (let i = 0; i < 50; i++) await (await fetch(\`http://localhost:\${server.port}/\`)).text();\n` +
        `server.stop(true);\n`,
    );
    writeFileSync(
      join(fixtures, "tests", "example.test.ts"),
      `import { expect, test } from "bun:test";\ntest("passes", () => { expect(1).toBe(1); });\n`,
    );
    // Reads stdin, writes stdout, drives readline — run once on a pipe and once
    // on a terminal.
    copyFileSync(join(here, "cli-fixture.js"), join(fixtures, "cli.js"));

    // `bun install`, offline: the one dependency is a tarball packed by the binary
    // we are about to trace, so a slow registry cannot cost a release its order
    // file. The rest is the real path — lockfile, extraction, node_modules.
    const dependency = join(fixtures, "dep");
    const app = join(fixtures, "app");
    mkdirSync(dependency);
    mkdirSync(app);
    writeFileSync(
      join(dependency, "package.json"),
      `{ "name": "orderfile-dep", "version": "1.0.0", "main": "index.js" }\n`,
    );
    writeFileSync(join(dependency, "index.js"), `module.exports = 1;\n`);
    const pack = runCommand([bunProfile, "pm", "pack", "--filename", "dep.tgz"], {
      cwd: dependency,
      label: "bun pm pack",
    });
    if (pack.status !== 0) throw new Error(`could not pack the install fixture\n${pack.stderr}`);
    writeFileSync(
      join(app, "package.json"),
      `{ "name": "orderfile-app", "version": "0.0.0", ` +
        `"dependencies": { "orderfile-dep": "file:../dep/dep.tgz" } }\n`,
    );
    const installEnv = { BUN_INSTALL_CACHE_DIR: join(scratch, "install-cache") };

    await checkpoint(interrupted);
    const steps: (Workload | WorkloadGroup)[] = [
      { name: "bun -e", args: ["-e", "console.log(1)"] },
      ...(windows ? [] : [appWorkloads(bunProfile, scratch)]),
      { name: "bun hello.ts", args: [join(fixtures, "hello.ts")] },
      { name: "bun server.js", args: [join(fixtures, "server.js")] },
      { name: "bun test", args: ["test", join(fixtures, "tests", "example.test.ts")] },
      { name: "bun install", args: ["install"], cwd: app, env: installEnv },
      { name: "bun install (cached)", args: ["install"], cwd: app, env: installEnv },
      { name: "bun cli.js (pipe)", args: [join(fixtures, "cli.js")], input: CLI_INPUT },
      {
        name: "bun cli.js (tty)",
        args: [join(fixtures, "cli.js")],
        input: CLI_INPUT,
        tty: true,
        env: { TERM: "xterm-256color" },
      },
    ];

    // ── Hints first ───────────────────────────────────────────────────────────
    const order: string[] = [];
    const seen = new Set<string>();
    if (options.hints?.length) {
      const listed = options.hints.flatMap(path => hintNames(readHintList(path), hostObjectFormat));
      const hints = resolveHints(listed, [...symbols.values()].flat());
      for (const name of hints.names) {
        seen.add(name);
        order.push(name);
      }
      log(
        `  hints: ${hints.exact + hints.normalized} of ${hints.listed} names resolved ` +
          `(${hints.exact} exactly, ${hints.normalized} by normalised name), ${hints.names.length} symbols`,
      );
    }
    const hinted = order.length;

    // ── Trace each workload, emit every name not yet seen ─────────────────────
    let launches = 0;
    const tracedAddresses = new Set<number>();
    /** What one workload runs as, its environment, and where its trace goes. */
    const launch = (workload: Workload) => {
      const out = join(scratch, `trace-${launches++}.bin`);
      const { cmd, env } = tracer.launch(workload, workload.exe ?? bunProfile);
      const options = {
        env: {
          ...env,
          BUN_FUNCTRACE_STARTS: startsPath,
          BUN_FUNCTRACE_OUT: out,
          BUN_DEBUG_QUIET_LOGS: "1",
          ...NO_PROXY_SETTINGS,
          ...workload.env,
        },
        cwd: workload.cwd,
        input: workload.input,
        label: `workload "${workload.name}"`,
      };
      return { cmd, options, out };
    };
    let traces = 0;
    const emit = (addresses: number[]) => {
      traces++;
      for (const address of addresses) tracedAddresses.add(address);
      return appendNames(order, seen, symbols, addresses);
    };

    for (const step of steps) {
      await checkpoint(interrupted);
      if (!("workloads" in step)) {
        const { cmd, options, out } = launch(step);
        const r = runCommand(cmd, { ...options, timeout: WORKLOAD_TIMEOUT_MS });
        if (r.status !== 0) throw new Error(`workload "${step.name}" exited ${r.status}\n${r.stderr}`);
        const { added, unresolved } = emit(readTrace(out, step.name));
        const note = unresolved ? ` (${unresolved} unresolved)` : "";
        log(`  ${step.name.padEnd(21)} +${added} functions${note}`);
        continue;
      }

      // A group's runs are independent processes with a trace each, so they run
      // several at a time; their traces are still taken in the group's order.
      const names = step.workloads.map(workload => workload.name);
      const { results, failures } = await runGroup(
        step.group,
        names,
        async (i, signal) => {
          const workload = step.workloads[i]!;
          const { cmd, options, out } = launch(workload);
          const r = await runCommandAsync(cmd, { ...options, timeout: GROUP_WORKLOAD_TIMEOUT_MS, signal });
          if (r.status !== 0) throw new Error(`workload "${workload.name}" exited ${r.status}\n${r.output}`);
          return readTrace(out, workload.name);
        },
        {
          concurrency: GROUP_CONCURRENCY,
          required: new Set(step.required),
          maxFailures: Math.floor(names.length * MAX_GROUP_FAILURES),
          timeoutMs: GROUP_TIMEOUT_MS,
          interrupted,
        },
      );

      let added = 0;
      let unresolved = 0;
      let resolved = 0;
      for (const trace of results) {
        if (!trace) continue;
        const result = emit(trace);
        added += result.added;
        unresolved += result.unresolved;
        resolved += trace.length - result.unresolved;
      }
      const ran = `${names.length - failures.length} of ${names.length} runs`;
      const note = unresolved ? ` (${unresolved} unresolved)` : "";
      log(`  ${`${step.group} (${ran})`.padEnd(21)} +${added} functions${note}`);
      if (failures.length) {
        console.warn(
          `warning: what only these ${step.group} workloads enter is missing from the order file: ` +
            failures.map(failure => failure.name).join(", "),
        );
        for (const failure of failures) console.warn(failure.message);
      }
      // sameCode compared the group's executable with the profile byte for byte;
      // what only shows at run time (a load address the tracer got wrong) shows here.
      if (unresolved > resolved) {
        throw new Error(`the ${step.group} workloads' traces do not match ${basename(bunProfile)}'s symbols`);
      }
    }

    // Counted apart from the order: good hints leave the workloads little to add.
    if (tracedAddresses.size < minFunctions) {
      throw new Error(
        `traced only ${tracedAddresses.size} functions, expected at least ${minFunctions} — ` +
          `the tracer or the symbol table is broken, and a near-empty order file silently costs the win`,
      );
    }

    const header = [
      `# ${tracer.linker}: functions bun executes while starting up,`,
      "# in first-entry order, so they land together at the front of .text.",
      "# Generated by scripts/orderfile/generate.ts — not committed.",
      `# ${order.length} functions from ${traces} workloads${hinted ? ` and ${hinted} hinted` : ""}.`,
    ];
    await checkpoint(interrupted);
    writeFileSync(outPath, header.join("\n") + "\n" + order.join("\n") + "\n");
    return { count: order.length, outPath };
  });
}

/** The value of `--name=value` in `argv`, if it is there. */
export function flagValue(argv: string[], name: string): string | undefined {
  return argv.find(flag => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (import.meta.main) {
  const repoRoot = resolve(here, "..", "..");
  const arg = (name: string) => flagValue(process.argv, name);
  const buildDir = resolve(repoRoot, arg("build-dir") ?? "build/release");
  // Relative --out is repo-root-relative, matching --build-dir.
  const out = arg("out");
  // Relative --hints paths are repo-root-relative too.
  const hints = arg("hints")
    ?.split(",")
    .filter(Boolean)
    .map(path => resolve(repoRoot, path));
  try {
    const options = {
      buildDir,
      verbose: true,
      ...(out ? { outPath: resolve(repoRoot, out) } : {}),
      ...(hints ? { hints } : {}),
    };
    const { count, outPath } = await generateOrderFile(options);
    console.log(`wrote ${outPath} (${count} functions)`);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
}
