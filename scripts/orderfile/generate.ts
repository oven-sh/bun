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

/** Many small workloads reported as one line, where one of them failing is a warning rather than an error. */
interface WorkloadGroup {
  group: string;
  workloads: Workload[];
}

export interface RunOptions {
  env?: Record<string, string | undefined> | undefined;
  cwd?: string | undefined;
  input?: string | undefined;
  timeout?: number | undefined;
  /** How the command is named in errors. Defaults to the executable. */
  label?: string | undefined;
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
  if (r.error) throw new Error(`${options.label ?? cmd[0]}: ${r.error.message}`);
  return r;
}

/**
 * `runCommand` without blocking, for workloads traced several at a time. Stdin
 * is a pipe that stays open until the command exits: on a terminal (ptyrun.c)
 * an end of input is typed as ^D, which an application sitting at its prompt
 * never sees.
 */
function runCommandAsync(cmd: string[], options: RunOptions = {}): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const label = options.label ?? cmd[0]!;
    const child = spawn(cmd[0]!, cmd.slice(1), {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // On a terminal the command's stderr arrives on stdout too. Only the end of
    // it is kept: it is there for an error message.
    let output = "";
    const keep = (chunk: Buffer) => (output = (output + chunk).slice(-2000));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = options.timeout === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), options.timeout);
    child.on("error", error => {
      clearTimeout(timer);
      reject(new Error(`${label}: ${error.message}`));
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (signal)
        reject(new Error(`${label}: killed by ${signal}${signal === "SIGKILL" ? " (timed out?)" : ""}\n${output}`));
      else resolve({ status, output });
    });
    child.stdin.on("error", () => {}); // the command may exit without reading
    if (options.input !== undefined) child.stdin.write(options.input);
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

/**
 * A name without what differs between two links of the same function: the
 * suffixes the optimizer gives its clones (`.llvm.123`, `.cold`, `.isra.0`, …),
 * and the extra underscore Mach-O puts before an Itanium or Rust mangled name,
 * so that a list traced on linux also serves a macOS link.
 */
const canonicalName = (name: string) => name.replace(CLONE_SUFFIXES, "").replace(/^_(?=_[ZR])/, "");

/** Whether a canonical name is in Rust's v0 mangling. */
const isRustName = (canonical: string) => canonical.startsWith("_R");

/**
 * Demangles Rust names, for comparing them across builds: the mangled form
 * carries a per-build hash for every crate (`Cs7kMPyjk15S4_15bun_collections`),
 * and the demangled form either omits it (llvm-cxxfilt) or brackets it
 * (`bun_collections[55704760041dd906]`, GNU c++filt), which is stripped here.
 * One run of $CXXFILT, llvm-cxxfilt or c++filt; with none installed the names
 * come back unchanged and only names from the same build of a crate match.
 */
function demangleRust(input: string[]): string[] {
  for (const tool of [process.env.CXXFILT, "llvm-cxxfilt", "c++filt"]) {
    if (!tool) continue;
    let r: ReturnType<typeof runCommand>;
    try {
      // -n: the names are canonical already, and the tools' defaults about a leading underscore differ by host.
      r = runCommand([tool, "-n"], { input: input.join("\n") + "\n" });
    } catch {
      continue; // not installed
    }
    const lines = r.stdout.toString().split("\n");
    if (r.status === 0 && lines.length >= input.length) {
      return lines.slice(0, input.length).map(line => line.replace(/\[[0-9a-f]{8,}\]/g, ""));
    }
  }
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
 * Maps hint names onto the current build's symbols. A name the build still has
 * is taken as it is. One it does not have is matched by canonical name
 * (`canonicalName`), and, for a Rust name, by its demangled form; every current symbol that
 * matches is taken, since they are clones of one function and which one runs
 * is not knowable from here. Names that match nothing are dropped, as the
 * linker drops them. The demangler only runs if a Rust name is left unmatched,
 * and only over the Rust names.
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
  const byCanonical = index(currentNames, currentNames.map(canonicalName));
  const unmatchedRust = hints.filter(
    hint => !have.has(hint) && isRustName(canonicalName(hint)) && !byCanonical.has(canonicalName(hint)),
  );
  let byDemangled = new Map<string, string[]>();
  const demangledHints = new Map<string, string>();
  if (unmatchedRust.length) {
    const currentRust = currentNames.filter(name => isRustName(canonicalName(name)));
    const demangled = demangle([...currentRust, ...unmatchedRust].map(canonicalName));
    byDemangled = index(currentRust, demangled.slice(0, currentRust.length));
    for (const [i, hint] of unmatchedRust.entries()) demangledHints.set(hint, demangled[currentRust.length + i]!);
  }

  const resolved: ResolvedHints = { names: [], listed: hints.length, exact: 0, normalized: 0 };
  const seen = new Set<string>();
  for (const hint of hints) {
    const matches = have.has(hint)
      ? [hint]
      : (byCanonical.get(canonicalName(hint)) ?? byDemangled.get(demangledHints.get(hint)!) ?? []);
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

/**
 * Whether `exe` carries the code of `profile`. The starts are link-time
 * addresses in the profile, and a breakpoint planted at one of them in any
 * other build lands mid-instruction. Stripping and `bun build --compile` both
 * leave the loaded segments where they were and append to the file, so one
 * build is byte-identical over any window early in the file, where two builds'
 * read-only data differs. Checked on ELF only, where that layout was verified.
 */
export function sameCode(profile: string, exe: string): boolean {
  if (process.platform !== "linux") return true;
  const window = (path: string) => {
    const buffer = Buffer.alloc(1 << 20);
    const fd = openSync(path, "r");
    try {
      return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 1 << 20));
    } finally {
      closeSync(fd);
    }
  };
  return window(profile).equals(window(exe));
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
 * Builds the app the app workloads run (app/scaffold.js) into one executable
 * with the binary under trace, and returns a workload per feature, in the
 * order app/features.txt gives. Each is a run of that executable on a terminal
 * with one feature selected, so what the order file takes from a run is that
 * feature's code and whatever earlier runs had not already entered.
 */
function appWorkloads(bunProfile: string, scratch: string): Workload[] {
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

  const features = readNameList(join(source, "features.txt"));
  const env = {
    ORDERFILE_APP_DATA: data,
    TMPDIR: temp,
    TERM: "xterm-256color",
    // The features talk to servers on 127.0.0.1. A proxy configured on the machine
    // would take those requests (and fail them); an empty value means none.
    http_proxy: "",
    HTTP_PROXY: "",
    https_proxy: "",
    HTTPS_PROXY: "",
  };
  return ["startup", ...features].map(feature => ({
    name: `app ${feature}`,
    exe,
    args: [],
    // Not wherever the generator was started: a bunfig.toml or package.json there would be read on every start.
    cwd: temp,
    tty: true,
    // The terminal features read keys; everything else ignores its stdin.
    ...(feature.startsWith("tui_") ? { input: "hello\r" } : {}),
    env: { ...env, ORDERFILE_FEATURES: feature },
  }));
}

/** More failures than this in a group means the group is broken, not that a feature had a bad day. */
const MAX_GROUP_FAILURES = 0.1;

/** The longest of a group's runs takes ~15 s under trace (the app's idle feature waits 11.5 s). */
const GROUP_WORKLOAD_TIMEOUT_MS = 60_000;

/** A group's runs mostly wait (on timers, a terminal, a local server), so more of them than cores is fine; the cap keeps JIT-heavy runs from starving each other's compiler threads. */
const GROUP_CONCURRENCY = Math.max(2, Math.min(8, availableParallelism()));

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

  const scratch = mkdtempSync(join(tmpdir(), "bun-orderfile-"));
  try {
    const tracer = windows ? buildWindowsTracer(scratch) : buildUnixTracer(scratch);

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

    const steps: (Workload | WorkloadGroup)[] = [
      { name: "bun -e", args: ["-e", "console.log(1)"] },
      ...(windows ? [] : [{ group: "app", workloads: appWorkloads(bunProfile, scratch) }]),
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
      const hints = resolveHints(options.hints.flatMap(readNameList), [...symbols.values()].flat());
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
    let runs = 0;
    const tracedAddresses = new Set<number>();
    /** What one workload runs as, its environment, and where its trace goes. */
    const launch = (workload: Workload) => {
      const out = join(scratch, `trace-${runs++}.bin`);
      const { cmd, env } = tracer.launch(workload, workload.exe ?? bunProfile);
      const options = {
        env: {
          ...env,
          BUN_FUNCTRACE_STARTS: startsPath,
          BUN_FUNCTRACE_OUT: out,
          BUN_DEBUG_QUIET_LOGS: "1",
          ...workload.env,
        },
        cwd: workload.cwd,
        input: workload.input,
        label: `workload "${workload.name}"`,
      };
      return { cmd, options, out };
    };
    const emit = (addresses: number[]) => {
      for (const address of addresses) tracedAddresses.add(address);
      return appendNames(order, seen, symbols, addresses);
    };

    for (const step of steps) {
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
      const traces: (number[] | Error)[] = new Array(step.workloads.length);
      let next = 0;
      const worker = async () => {
        while (next < step.workloads.length) {
          const i = next++;
          const workload = step.workloads[i]!;
          const { cmd, options, out } = launch(workload);
          try {
            const r = await runCommandAsync(cmd, { ...options, timeout: GROUP_WORKLOAD_TIMEOUT_MS });
            if (r.status !== 0) throw new Error(`workload "${workload.name}" exited ${r.status}\n${r.output}`);
            traces[i] = readTrace(out, workload.name);
          } catch (error) {
            traces[i] = error as Error;
          }
        }
      };
      await Promise.all(Array.from({ length: GROUP_CONCURRENCY }, worker));

      // One of a group's hundreds of small runs failing costs the order file a few
      // functions; failing the release's order file over it would cost all of them.
      let added = 0;
      let unresolved = 0;
      let resolved = 0;
      const failures: string[] = [];
      for (const trace of traces) {
        if (trace instanceof Error) {
          failures.push(trace.message);
          continue;
        }
        const result = emit(trace);
        added += result.added;
        unresolved += result.unresolved;
        resolved += trace.length - result.unresolved;
      }
      const note = unresolved ? ` (${unresolved} unresolved)` : "";
      log(`  ${`${step.group} (${step.workloads.length} runs)`.padEnd(21)} +${added} functions${note}`);
      for (const failure of failures) console.warn(`warning: ${failure}`);
      if (failures.length > step.workloads.length * MAX_GROUP_FAILURES) {
        throw new Error(
          `${failures.length} of the ${step.workloads.length} ${step.group} workloads failed; the first:\n${failures[0]}`,
        );
      }
      // The group's executable is not the file the symbols were read from. If its
      // code ever stops lining up with them, this is where it shows.
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
      `# ${order.length} functions from ${runs} workloads${hinted ? ` and ${hinted} hinted` : ""}.`,
    ];
    writeFileSync(outPath, header.join("\n") + "\n" + order.join("\n") + "\n");
    return { count: order.length, outPath };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
