---
name: jsc-perf-report
description: Enumerate the JSC (WebKit) performance changes that landed between an older Bun release and current main, add benchmarks to bench/snippets that demonstrate them, measure old vs new binaries, and produce an English report (optionally as a PR).
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Agent
  - AskUserQuestion
when_to_use: Use only when the user explicitly invokes /jsc-perf-report (do not auto-trigger).
argument-hint: "[old-version e.g. 1.3.14 (defaults to the system bun version)]"
arguments:
  - old_version
---

# JSC Performance Report (old release vs main)

Identify the JSC-side performance improvements that landed between an older Bun release
(`$old_version`, defaulting to the system `bun --version`) and current main, add benchmarks
to `bench/snippets/` that demonstrate them, measure both binaries, and produce an English
report (optionally used verbatim as a PR description).

## Inputs
- `$old_version`: the old Bun version (e.g. `1.3.14`). Defaults to the system-installed bun.

## Goal
- A list of JSC performance changes that are *genuinely new* between the old release and main, accounting for the squash-merge cutoff
- Only benchmarks whose improvement was demonstrated by measurement are added to `bench/snippets/`
- An English report where each section is: snippet / old-vs-main time table / "x.y times faster" / upstream commit + author
- (If the user wants) a PR on a `claude/` branch whose description is the report

## Steps

### 1. Determine the old and new WEBKIT_VERSION
- Old: `git show bun-v$old_version:scripts/build/deps/webkit.ts | grep WEBKIT_VERSION`
- New: `scripts/build/deps/webkit.ts` on main
- `vendor/WebKit` is a full clone of oven-sh/WebKit. Verify both SHAs exist there.
- Check whether trailing pin bumps (cross-compile etc.) contain any JSC changes with
  `git -C vendor/WebKit log A..B -- Source/JavaScriptCore` (if not, an older build can be treated as JSC-equivalent to main).

**Success criteria**: The old/new WebKit SHAs and the number of commits touching `Source/JavaScriptCore` between them are known.

### 2. Determine the squash-merge cutoff and what is genuinely new
- oven-sh/WebKit takes upstream via **squash merges** (title: `Merge upstream/main (<upstream-sha>)`).
  Because of this, the `old..new` SHA range also lists upstream commits that the old release already contains.
- Find the latest such squash reachable from the OLD pin:
  `git -C vendor/WebKit log --oneline <old-pin> --grep "Merge upstream/main" | head -1`
  → the `<upstream-sha>` in its title is the cutoff.
- A change is genuinely new only if `git -C vendor/WebKit merge-base --is-ancestor <sha> <cutoff>` is false
  (true means the old release already has it).

**Rules**: Never declare a commit "new" from the SHA-range git log alone. When a benchmark shows no difference, first suspect that the change is already in the old release.
**Success criteria**: The cutoff SHA (≈ canonical number) is determined and every perf-related commit is classified as new vs already-in-old.
**Artifacts**: Cutoff SHA, list of genuinely-new commits.

### 3. Research the performance-related commits (fork)
- Start from `git -C vendor/WebKit log --oneline --no-merges <old>..<new> -- Source/JavaScriptCore` and pick the performance-related ones.
- Delegate to a fork (Agent without subagent_type) that writes a file with, per commit:
  title / bugs.webkit.org link / canonical link (commits.webkit.org/NNNNN@main) / author (`git show -s --format=%an`) /
  any performance numbers quoted in the commit message / a 1–2 sentence summary.
  Organize by category (Promise/async, Array, String, objects/property access, modules, JIT/codegen, memory).
- Include memory reductions (smaller sizeof, removed allocations), not just throughput.

**Execution**: Delegate the research to a fork; receive the result as a file (e.g. /tmp/jsc-perf-research.md).
**Success criteria**: A file listing the genuinely-new perf commits with links, authors, and upstream-claimed numbers.

### 4. Prepare the old and new binaries
- Old: the system bun (or the released binary for `$old_version`). Confirm with `bun --revision`.
- New: **an existing release build / canary may be reused if its WebKit pin is JSC-equivalent to main**
  (no `Source/JavaScriptCore` diffs in between). Otherwise propose `bun run build:release`.
- Never measure with debug builds. Do not run builds or other CPU-heavy work concurrently with measurements.

**Success criteria**: Paths and revisions of both binaries are fixed, and the new binary is confirmed JSC-equivalent to main.

### 5. Write benchmarks, measure, and triage
- Add files to `bench/snippets/*.mjs` (default form: mitata via `import { bench, run } from "../runner.mjs"`).
- Benchmark design rules:
  - Vary operands per iteration to defeat LICM / constant folding (treat ~0.1 ns results as invalid).
  - For JIT-dependent (DFG/FTL) optimizations, put a hot loop of ≥1e5 iterations at a single call site inside the bench body.
    Use the upstream `JSTests/microbenchmarks/*.js` files (in vendor/WebKit) as the model for the shape.
  - If the mitata shape does not show the win, it is fine to copy the upstream microbenchmark file nearly verbatim as a
    plain (non-mitata) snippet: stub `noInline` etc., time with `performance.now`, run directly with `bun <file>`.
  - For memory, use `bun:jsc` heapStats + RSS after `Bun.gc(true)`. Watch for retention bugs (the objects you want to measure being GC'd).
  - For module graphs, use `bench/module-loader/create-tla-graph.js` (ladder shape; very deep import chains overflow the stack).
- Measurement rules:
  - Always redirect `BENCHMARK_RUNNER=1 <bun> <file>.mjs` JSON output to a file (piping truncates at 64KB).
  - Alternate old/new runs and take medians; first runs can be slow, so do 2–3 runs.
  - Re-verify any surprising result (regression or huge win) with a standalone plain script run directly.
    Measuring through a dynamic-import wrapper can inflate the old side.
- Summarize results in an old-vs-new table, then **show the user which benchmarks failed to demonstrate an improvement and confirm before deleting them**.

**Human checkpoint**: Always confirm before deleting benchmarks that showed no win.
**Success criteria**: Every benchmark that remains demonstrates an improvement (or the intended memory reduction) by measurement. Any regressions found are listed separately.
**Artifacts**: Old/new numbers per benchmark (used in the report).

### 6. Promise memory and module-graph measurements
- Promise: `bench/snippets/promise-memory.mjs` style (e.g. bytes per pending promise + `.then(handler)`).
- Modules: generate graphs with `create-tla-graph.js` (TLA cascade etc.) and measure import time and RSS/heapSize, optionally with `/usr/bin/time -l`.
- Module loading is usually dominated by Bun-side cost (resolver/transpiler). Show the JSC-side effect at a scale where the
  quadratic term dominates (e.g. a 50,000-module ladder), and state the attribution limits in the report.

**Success criteria**: Memory and module numbers are collected (skip if no related JSC changes exist in the range).

### 7. Write the English report
- Per-section format:
  - `## \`API name\``
  - a short ```js snippet describing the measured workload (an illustrative excerpt is fine)
  - a `| version | time |` table (old version / main)
  - `x.y times faster` (with extra cases in parentheses if useful)
  - `upstream commit: https://commits.webkit.org/NNNNN@main by <GitHub handle>` (author from `git show -s --format='%an'`)
- Start with the comparison environment (both binaries and WebKit pins, methodology) and a NOTE that the snippets
  shown are simplified excerpts — the actual measurements were taken with the benchmark files added.
- Only include sections whose improvement was demonstrated. Use only the numbers measured in steps 5/6
  (never present upstream-claimed numbers as if they were measured here).

**Success criteria**: An English report where every section has measured numbers, correct upstream links, and authors.
**Artifacts**: The report body (used as the PR description).

### 8. Create the PR (optional)
- Only if the user wants a PR.
- Branch name must start with `claude/` (CI requirement). Commit only the benchmark files (no reports, no generated artifacts).
- PR description: `This PR adds microbenchmarks for latest JSC changes` + `---` + the full report.
- Delete generated module graphs and other temporary artifacts before committing.

**Human checkpoint**: Always confirm before pushing / creating the PR.
**Success criteria**: The PR is created and its URL is reported. The working tree contains nothing besides the benchmark files.
