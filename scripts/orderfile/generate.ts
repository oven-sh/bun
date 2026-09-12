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
 * The file is never committed. Release builds generate it from their own pass-1
 * binary and relink against it; canary builds inherit the file an earlier
 * build's trace-order step traced from that build's binary (scripts/build/ci.ts
 * inheritOrderFile; getTraceOrderStep in .buildkite/ci.mjs). Locally:
 *
 *   bun run orderfile                      # uses build/release, writes build/release/linker.order
 *   bun run orderfile -- --build-dir=build/release-lto
 *
 * Generating against the profile you ship is worth ~1 MB of RSS: the LTO build
 * linked with a file generated from the plain release build lands at 22.6 MB,
 * and at 21.6 MB with its own.
 *
 * Linux x86-64/arm64, macOS arm64, and Windows x64/arm64. Linux is the lld
 * `--symbol-ordering-file` input, macOS Apple ld's `-order_file`, Windows
 * lld-link's `/order:@`; all three take one symbol name per line.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  args: string[];
  /** Working directory for the traced process. */
  cwd?: string;
  /** Typed into stdin; on a terminal it arrives as keystrokes. */
  input?: string;
  /** Run on a pseudo-terminal rather than pipes (see ptyrun.c). */
  tty?: boolean;
  env?: Record<string, string>;
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
function writeStarts(path: string, addresses: number[]): void {
  const buffer = new ArrayBuffer((STARTS_HEADER_WORDS + addresses.length) * 8);
  const words = new BigUint64Array(buffer);
  words[0] = STARTS_MAGIC;
  words[1] = 1n;
  words[2] = BigInt(addresses.length);
  for (let i = 0; i < addresses.length; i++) words[STARTS_HEADER_WORDS + i] = BigInt(addresses[i]!);
  writeFileSync(path, new Uint8Array(buffer));
}

/** Read a trace the tracer wrote: first-entry addresses, slide already removed. */
function readTrace(path: string, name: string): number[] {
  const raw = readFileSync(path);
  if (raw.byteLength < TRACE_HEADER_WORDS * 8) throw new Error(`workload "${name}" wrote a truncated trace`);
  const header = new BigUint64Array(raw.buffer, raw.byteOffset, TRACE_HEADER_WORDS);
  if (header[0] !== TRACE_MAGIC || header[1] !== 1n) throw new Error(`workload "${name}" wrote an invalid trace`);
  const count = Number(header[4]);
  if (count === 0) throw new Error(`workload "${name}" recorded no entries — is the tracer loading?`);
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
 * functrace.c rides into the traced process on the loader's preload variable.
 * The terminal workload runs under ptyrun.c, which is then the traced process's
 * parent, so it is handed the preload to pass down rather than loading it itself.
 */
function buildUnixTracer(scratch: string): Tracer {
  const darwin = process.platform === "darwin";
  const tracer = join(scratch, darwin ? "functrace.dylib" : "functrace.so");
  const ptyrun = join(scratch, "ptyrun");
  const cc = process.env.CC || "cc";
  const build = runCommand(
    darwin
      ? [cc, "-O2", "-dynamiclib", "-fPIC", "-o", tracer, join(here, "functrace.c")]
      : [cc, "-O2", "-shared", "-fPIC", "-o", tracer, join(here, "functrace.c"), "-ldl", "-lpthread"],
  );
  if (build.status !== 0) throw new Error(`failed to build the tracer with ${cc}\n${build.stderr}`);
  const pty = runCommand([cc, "-O2", "-o", ptyrun, join(here, "ptyrun.c"), ...(darwin ? [] : ["-lutil"])]);
  if (pty.status !== 0) throw new Error(`failed to build the pty runner with ${cc}\n${pty.stderr}`);

  const preloadVar = darwin ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD";
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

export function generateOrderFile(options: GenerateOptions): { count: number; outPath: string } {
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

    const workloads: Workload[] = [
      { name: "bun -e", args: ["-e", "console.log(1)"] },
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

    // ── Trace each workload, emit every name not yet seen ─────────────────────
    const order: string[] = [];
    const seen = new Set<string>();
    for (const [i, workload] of workloads.entries()) {
      const out = join(scratch, `trace-${i}.bin`);
      const { cmd, env } = tracer.launch(workload, bunProfile);
      const r = runCommand(cmd, {
        env: {
          ...env,
          BUN_FUNCTRACE_STARTS: startsPath,
          BUN_FUNCTRACE_OUT: out,
          BUN_DEBUG_QUIET_LOGS: "1",
          ...workload.env,
        },
        cwd: workload.cwd,
        input: workload.input,
        timeout: WORKLOAD_TIMEOUT_MS,
        label: `workload "${workload.name}"`,
      });
      if (r.status !== 0) throw new Error(`workload "${workload.name}" exited ${r.status}\n${r.stderr}`);

      const before = order.length;
      let unresolved = 0;
      for (const address of readTrace(out, workload.name)) {
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
      const note = unresolved ? ` (${unresolved} unresolved)` : "";
      log(`  ${workload.name.padEnd(21)} +${order.length - before} functions${note}`);
    }

    if (order.length < minFunctions) {
      throw new Error(
        `traced only ${order.length} functions, expected at least ${minFunctions} — ` +
          `the tracer or the symbol table is broken, and a near-empty order file silently costs the win`,
      );
    }

    const header = [
      `# ${tracer.linker}: functions bun executes while starting up,`,
      "# in first-entry order, so they land together at the front of .text.",
      "# Generated by scripts/orderfile/generate.ts — not committed.",
      `# ${order.length} functions from ${workloads.length} workloads.`,
    ];
    writeFileSync(outPath, header.join("\n") + "\n" + order.join("\n") + "\n");
    return { count: order.length, outPath };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const repoRoot = resolve(here, "..", "..");
  const arg = (name: string, fallback?: string): string | undefined => {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const buildDir = resolve(repoRoot, arg("build-dir", "build/release")!);
  // Relative --out is repo-root-relative, matching --build-dir.
  const out = arg("out");
  try {
    const options = { buildDir, verbose: true, ...(out ? { outPath: resolve(repoRoot, out) } : {}) };
    const { count, outPath } = generateOrderFile(options);
    console.log(`wrote ${outPath} (${count} functions)`);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
}
