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
 * The file is never committed. Release builds generate it from their own pass-1
 * binary and relink against it; canary builds link against the last successful
 * build's file (see store.ts) and publish a fresh one. Locally:
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  function run(cmd: string[], env?: Record<string, string | undefined>) {
    const r = spawnSync(cmd[0]!, cmd.slice(1), {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 29, // nm prints ~10 MB of symbols
    });
    if (r.error) throw r.error;
    return r;
  }

  const scratch = mkdtempSync(join(tmpdir(), "bun-orderfile-"));
  try {
    // ── Build the tracer ──────────────────────────────────────────────────────
    const tracer = join(scratch, "pagetrace.so");
    const cc = process.env.CC || "cc";
    const build = run([cc, "-O2", "-shared", "-fPIC", "-o", tracer, join(here, "pagetrace.c"), "-ldl"]);
    if (build.status !== 0) throw new Error(`failed to build the tracer with ${cc}\n${build.stderr}`);

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

    const workloads: { name: string; args: string[] }[] = [
      { name: "bun -e", args: ["-e", "console.log(1)"] },
      { name: "bun hello.ts", args: [join(fixtures, "hello.ts")] },
      { name: "bun server.js", args: [join(fixtures, "server.js")] },
      { name: "bun test", args: ["test", join(fixtures, "tests", "example.test.ts")] },
    ];

    const traces: { name: string; pageSize: number; pages: BigUint64Array }[] = [];
    for (const [i, workload] of workloads.entries()) {
      const out = join(scratch, `trace-${i}.bin`);
      const r = run([bunProfile, ...workload.args], {
        LD_PRELOAD: tracer,
        BUN_PAGETRACE_BIN: bunProfile,
        BUN_PAGETRACE_OUT: out,
        BUN_DEBUG_QUIET_LOGS: "1",
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
    const symbols = run([nm, "--defined-only", "-S", "--numeric-sort", bunProfile]);
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
      log(`  ${trace.name.padEnd(16)} ${visited.size} pages touched, +${order.length - before} functions`);
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
