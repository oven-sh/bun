#!/usr/bin/env bun
/**
 * Generates the lld `--symbol-ordering-file` that packs bun's startup-hot
 * functions together at the front of `.text`.
 *
 * Why it exists: a `bun -e 'console.log(1)'` only executes ~8.5 MB worth of
 * pages, but they are scattered over a 50 MB `.text`, and Linux faults in 64 KB
 * around every one of them. Sorting those functions to the front of `.text`
 * cuts the resident binary pages roughly in half with no change to the binary's
 * size and no change to what the code does.
 *
 * How: `pagetrace.c` is an LD_PRELOAD shim that mprotects the executable's own
 * text+rodata to PROT_NONE and unprotects one page per SIGSEGV, so it records
 * exactly the pages a run touches. We run a handful of representative
 * workloads, map every touched page back to the function that owns it (`nm -S`
 * on the unstripped `bun-profile`), and emit those function names in first-touch
 * order. Symbols lld cannot find are ignored, so the file degrades gracefully
 * as code moves.
 *
 * One workload runs under `ptyrun.c`, on a pseudo-terminal: bun's stdio, tty
 * and readline code is a different path on a terminal than on a pipe, and the
 * functions it reaches are ~2k that no other workload touches.
 *
 * The file is never committed. Release builds generate it from their own pass-1
 * binary and relink against it; canary builds inherit the last successful
 * build's file and re-publish it (scripts/build/ci.ts — inheritOrderFile /
 * packageAndUpload). Locally:
 *
 *   bun run orderfile                      # uses build/release, writes build/release/linker.order
 *   bun run orderfile -- --build-dir=build/release-lto
 *
 * Generating against the profile you ship is worth ~1 MB of RSS: the LTO build
 * linked with a file generated from the plain release build lands at 22.6 MB,
 * and at 21.6 MB with its own.
 *
 * Re-running against a build that already has an order file converges rather
 * than drifting: a cold function only ever gets listed because it shares a page
 * with a hot one, and once the hot functions are packed together those cold
 * neighbours stop being touched and drop out. Hot functions always own at least
 * one touched page, so they are never lost.
 *
 * Linux only — it is the `--symbol-ordering-file` input for the ELF link, and
 * the tracer depends on /proc/self/maps.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HEADER_WORDS = 2; // must match pagetrace.c: page size, count

// `import.meta.dir` is Bun-only; scripts/build/ imports this under node too.
const here = dirname(fileURLToPath(import.meta.url));

/**
 * A trace that resolves almost nothing is worse than no file at all: it silently
 * costs the win while looking like it worked. Real runs land near ~16k
 * functions, so anything this low means the tracer or the symbol table broke.
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
  /** Unstripped binary to trace. Defaults to `bun-profile`; an assertions build names it differently. */
  exeName?: string;
  /** Where to write the order file. Defaults to `<buildDir>/linker.order`. */
  outPath?: string;
  /** Fail if fewer than this many functions were traced. */
  minFunctions?: number;
  /** Print per-workload progress. */
  verbose?: boolean;
}

export function generateOrderFile(options: GenerateOptions): { count: number; outPath: string } {
  const buildDir = resolve(options.buildDir);
  const outPath = resolve(options.outPath ?? join(buildDir, "linker.order"));
  const minFunctions = options.minFunctions ?? MIN_FUNCTIONS;
  const log = (message: string) => options.verbose && console.log(message);

  if (process.platform !== "linux") {
    throw new Error("the order file is an ELF linker input; generate it on linux");
  }

  // The unstripped binary: its symbol table is what maps pages back to functions.
  const bunProfile = join(buildDir, options.exeName ?? "bun-profile");
  if (!existsSync(bunProfile)) {
    throw new Error(`${bunProfile} not found — build it first (bun run build:release)`);
  }

  const scratch = mkdtempSync(join(tmpdir(), "bun-orderfile-"));
  try {
    // ── Build the tracer and the pty runner ───────────────────────────────────
    const tracer = join(scratch, "pagetrace.so");
    const ptyrun = join(scratch, "ptyrun");
    const cc = process.env.CC || "cc";
    const build = runCommand([cc, "-O2", "-shared", "-fPIC", "-o", tracer, join(here, "pagetrace.c"), "-ldl"]);
    if (build.status !== 0) throw new Error(`failed to build the tracer with ${cc}\n${build.stderr}`);
    const pty = runCommand([cc, "-O2", "-o", ptyrun, join(here, "ptyrun.c"), "-lutil"]);
    if (pty.status !== 0) throw new Error(`failed to build the pty runner with ${cc}\n${pty.stderr}`);

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

    const traces: { name: string; pageSize: number; pages: BigUint64Array }[] = [];
    for (const [i, workload] of workloads.entries()) {
      const out = join(scratch, `trace-${i}.bin`);
      // The tracer loads into the traced process and nowhere else. On a terminal
      // ptyrun is the parent, so it is the one that hands the preload down.
      const preload = workload.tty ? { PTYRUN_PRELOAD: tracer } : { LD_PRELOAD: tracer };
      const r = runCommand(workload.tty ? [ptyrun, bunProfile, ...workload.args] : [bunProfile, ...workload.args], {
        env: {
          ...preload,
          BUN_PAGETRACE_BIN: bunProfile,
          BUN_PAGETRACE_OUT: out,
          BUN_DEBUG_QUIET_LOGS: "1",
          ...workload.env,
        },
        cwd: workload.cwd,
        input: workload.input,
        timeout: WORKLOAD_TIMEOUT_MS,
        label: `workload "${workload.name}"`,
      });
      if (r.status !== 0) throw new Error(`workload "${workload.name}" exited ${r.status}\n${r.stderr}`);

      const raw = readFileSync(out);
      const header = new BigUint64Array(raw.buffer, raw.byteOffset, HEADER_WORDS);
      const pageSize = Number(header[0]);
      const capacity = raw.byteLength / 8 - HEADER_WORDS;
      // The tracer's counter keeps climbing past MAX_HITS if a run ever overflows.
      const count = Math.min(Number(header[1]), capacity);
      if (count === 0) throw new Error(`workload "${workload.name}" recorded no faults — is LD_PRELOAD working?`);
      traces.push({
        name: workload.name,
        pageSize,
        pages: new BigUint64Array(raw.buffer, raw.byteOffset + HEADER_WORDS * 8, count),
      });
    }

    // ── Symbol table ──────────────────────────────────────────────────────────
    const nm = process.env.NM || (existsSync("/usr/bin/llvm-nm") ? "llvm-nm" : "nm");
    const symbols = runCommand([nm, "--defined-only", "-S", "--numeric-sort", bunProfile]);
    if (symbols.status !== 0) throw new Error(`${nm} failed on ${bunProfile}\n${symbols.stderr}`);

    // `t`/`T` only: ordering `.rodata.*` separates constants from the mergeable
    // string/constant pools they sit next to, which costs more pages than it saves.
    const starts: number[] = [];
    const ends: number[] = [];
    const names: string[] = [];
    for (const line of symbols.stdout.toString().split("\n")) {
      const m = /^([0-9a-f]+) ([0-9a-f]+) (\w) (\S+)$/.exec(line);
      if (!m || (m[3] !== "t" && m[3] !== "T")) continue;
      const address = parseInt(m[1]!, 16);
      starts.push(address);
      ends.push(address + parseInt(m[2]!, 16));
      names.push(m[4]!);
    }
    if (!starts.length) throw new Error(`${nm} reported no sized functions — is ${bunProfile} stripped?`);

    /** Index of the last symbol starting at or before `page`, or -1. */
    function lowerBound(page: number): number {
      let lo = 0;
      let hi = starts.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid]! <= page) {
          ans = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return ans;
    }

    const order: string[] = [];
    const seen = new Set<string>();
    for (const trace of traces) {
      const before = order.length;
      const visited = new Set<number>();
      for (const raw of trace.pages) {
        const page = Number(raw);
        if (visited.has(page)) continue;
        visited.add(page);
        // Symbols overlapping [page, page + pageSize). Walk back far enough to
        // catch a function that started earlier and spans into this page.
        let i = Math.max(0, lowerBound(page));
        while (i > 0 && starts[i - 1]! + 0x100000 > page) i--;
        for (; i < starts.length && starts[i]! < page + trace.pageSize; i++) {
          const name = names[i]!;
          if (ends[i]! <= page || seen.has(name)) continue;
          seen.add(name);
          order.push(name);
        }
      }
      log(`  ${trace.name.padEnd(21)} ${visited.size} pages touched, +${order.length - before} functions`);
    }

    if (order.length < minFunctions) {
      throw new Error(
        `traced only ${order.length} functions, expected at least ${minFunctions} — ` +
          `the tracer or the symbol table is broken, and a near-empty order file silently costs the win`,
      );
    }

    const header = [
      "# lld --symbol-ordering-file: functions bun executes while starting up,",
      "# in first-touch order, so they land together at the front of .text.",
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
