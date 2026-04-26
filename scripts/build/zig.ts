/**
 * Zig toolchain download + zig build step.
 *
 * Bun uses a FORK of zig at a pinned commit (oven-sh/zig). The compiler
 * is downloaded as a prebuilt binary from releases (same pattern as WebKit).
 * The downloaded zig includes its own stdlib (vendor/zig/lib/) — we don't
 * rely on any system zig.
 *
 * The zig BUILD is one big `zig build obj` invocation with ~18 -D flags.
 * Zig's own build system (build.zig) handles the per-file compilation; our
 * ninja rule just invokes it and declares the output. restat lets zig's
 * incremental compilation prune downstream when nothing changed.
 *
 * The compiler download is performed by `fetchZig()` below, invoked by
 * ninja via fetch-cli.ts.
 */

import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism, homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "./config.ts";
import { downloadWithRetry, extractZip, tryPrefetchExtracted } from "./download.ts";
import { BuildError, assert } from "./error.ts";
import { fetchCliPath } from "./fetch-cli.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs } from "./shell.ts";
import { streamPath } from "./stream.ts";

/**
 * Zig compiler commit — determines compiler download + bundled stdlib.
 * Override via `--zig-commit=<hash>` to test a new compiler.
 * From https://github.com/oven-sh/zig releases.
 */
export const ZIG_COMMIT = "560aed0c6508412c2177866c54ad0aa3eef41e3f";

/**
 * Number of LLVM codegen units. >1 splits the build into N independent
 * LLVM modules — parallelises emit, but cross-unit calls become
 * `linkonce_odr` externs so LLVM can't inline or IPO across them.
 *
 * Sharding is gated off for:
 *   - Non-ASAN CI: shipped releases want full IPO; cg=1 keeps that and
 *     keeps the upload/download contract a single file.
 *   - Windows targets: COFF shard emission is unimplemented in oven-sh/zig.
 *   - LTO: zig_llvm.cpp gates SplitModule on !lto, so cg>1 would emit one
 *     .o instead of N and the no_merge_shards path would expect missing files.
 *
 * ASAN CI uses a FIXED count (CI_ASAN_CODEGEN_THREADS) so zig-only and
 * link-only — which run on different machines — agree on the artifact
 * names. Local builds shard at availableParallelism(); benchmark against
 * a non-ASAN CI artifact if cross-unit inlining matters.
 */
function codegenThreads(cfg: Config): number {
  if (cfg.windows) return 1;
  if (cfg.lto) return 1;
  if (cfg.ci) {
    // ASAN is a test-only build (not shipped), so cross-shard IPO loss is
    // fine and the speedup is worth it. The count is FIXED so zig-only and
    // link-only — which run on different machines — agree on the artifact
    // names. Non-asan CI stays at 1: shipped releases want full IPO.
    return cfg.asan ? CI_ASAN_CODEGEN_THREADS : 1;
  }
  return availableParallelism();
}

/** Fixed shard count for CI ASAN builds. Matches getZigAgent's instance size. */
export const CI_ASAN_CODEGEN_THREADS = 8;

/**
 * Output object file names for the zig step, matching what build.zig emits.
 * Shared between emitZig (zig-only/full) and emitLinkOnly so both sides of
 * the CI artifact split agree on filenames.
 */
export function zigObjectPaths(cfg: Config): string[] {
  const cg = codegenThreads(cfg);
  return cg > 1
    ? Array.from({ length: cg }, (_, i) => resolve(cfg.buildDir, `bun-zig.${i}.o`))
    : [resolve(cfg.buildDir, "bun-zig.o")];
}

// ───────────────────────────────────────────────────────────────────────────
// Target/optimize/CPU computation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Zig target triple. Arch is always `x86_64`/`aarch64` (zig's naming),
 * not `x64`/`arm64`.
 */
export function zigTarget(cfg: Config): string {
  const arch = cfg.x64 ? "x86_64" : "aarch64";
  if (cfg.darwin) return `${arch}-macos-none`;
  if (cfg.windows) return `${arch}-windows-msvc`;
  if (cfg.freebsd) {
    assert(cfg.freebsdVersion !== undefined, "freebsd build missing version");
    return `${arch}-freebsd.${cfg.freebsdVersion}-none`;
  }
  // linux: abi is always set (resolveConfig asserts)
  assert(cfg.abi !== undefined, "linux build missing abi");
  if (cfg.abi === "android") {
    assert(cfg.androidApiLevel !== undefined, "android build missing api level");
    return `${arch}-linux-android.${cfg.androidApiLevel}`;
  }
  return `${arch}-linux-${cfg.abi}`;
}

/**
 * Zig doesn't bundle bionic or FreeBSD libc headers, so cross-compile
 * targets need an explicit libc file (`--libc`) pointing at the sysroot
 * for Compile steps, and the sysroot path passed separately for
 * translate-c. Writes the libc file at configure time (idempotent via
 * writeIfChanged).
 */
function crossLibcArgs(cfg: Config): string[] {
  if (cfg.abi === "android") {
    assert(cfg.sysroot !== undefined && cfg.androidApiLevel !== undefined, "android build missing sysroot");
    const archTriple = cfg.x64 ? "x86_64-linux-android" : "aarch64-linux-android";
    const libcFile = resolve(cfg.buildDir, "android-libc.txt");
    writeIfChanged(
      libcFile,
      [
        `include_dir=${cfg.sysroot}/usr/include`,
        `sys_include_dir=${cfg.sysroot}/usr/include/${archTriple}`,
        `crt_dir=${cfg.sysroot}/usr/lib/${archTriple}/${cfg.androidApiLevel}`,
        `msvc_lib_dir=`,
        `kernel32_lib_dir=`,
        `gcc_dir=`,
        ``,
      ].join("\n"),
    );
    return ["--libc", libcFile, `-Dandroid_ndk_sysroot=${cfg.sysroot}`];
  }
  if (cfg.freebsd) {
    // Native FreeBSD host: sysroot is "/". Cross-compile: extracted base.txz.
    // build.zig requires -Dfreebsd_sysroot for translate-c either way.
    const root = cfg.sysroot ?? "";
    const libcFile = resolve(cfg.buildDir, "freebsd-libc.txt");
    writeIfChanged(
      libcFile,
      [
        `include_dir=${root}/usr/include`,
        `sys_include_dir=${root}/usr/include`,
        `crt_dir=${root}/usr/lib`,
        `msvc_lib_dir=`,
        `kernel32_lib_dir=`,
        `gcc_dir=`,
        ``,
      ].join("\n"),
    );
    return ["--libc", libcFile, `-Dfreebsd_sysroot=${root || "/"}`];
  }
  return [];
}

/**
 * Zig optimize level.
 *
 * The Windows ReleaseFast → ReleaseSafe downgrade is intentional: since
 * Bun 1.1, Windows builds use ReleaseSafe because it caught more crashes.
 * This is a load-bearing workaround; don't "fix" it.
 */
export function zigOptimize(cfg: Config): "Debug" | "ReleaseFast" | "ReleaseSafe" | "ReleaseSmall" {
  let opt: "Debug" | "ReleaseFast" | "ReleaseSafe" | "ReleaseSmall";
  switch (cfg.buildType) {
    case "Debug":
      opt = "Debug";
      break;
    case "Release":
      opt = cfg.asan ? "ReleaseSafe" : "ReleaseFast";
      break;
    case "RelWithDebInfo":
      opt = "ReleaseSafe";
      break;
    case "MinSizeRel":
      opt = "ReleaseSmall";
      break;
  }
  // Windows: never ReleaseFast. See header comment.
  if (cfg.windows && opt === "ReleaseFast") {
    opt = "ReleaseSafe";
  }
  return opt;
}

/**
 * Zig CPU target.
 *
 * arm64: apple_m1 (darwin), cortex_a76 (windows — no ARMv9 windows yet),
 *   native (linux — no baseline arm64 builds needed).
 * x64: nehalem (baseline, pre-AVX), haswell (AVX2).
 */
export function zigCpu(cfg: Config): string {
  if (cfg.arm64) {
    if (cfg.darwin) return "apple_m1";
    if (cfg.windows) return "cortex_a76";
    return "native";
  }
  // x64
  return cfg.baseline ? "nehalem" : "haswell";
}

/**
 * Whether to download the ReleaseSafe build of the zig COMPILER itself
 * (not bun's zig code — this is about the compiler binary).
 *
 * CI defaults to yes (better error messages on compiler crashes). EXCEPT
 * windows-arm64 HOST, where the ReleaseSafe compiler has an LLVM SEH
 * epilogue bug that produces broken compiler_rt. Host, not target — the
 * compiler runs on the host; zig-only cross-compile runs on linux.
 */
export function zigCompilerSafe(cfg: Config): boolean {
  if (cfg.ci && cfg.host.os === "windows" && cfg.host.arch === "aarch64") return false;
  return cfg.ci;
}

/**
 * Whether codegen outputs should be @embedFile'd into the binary (release)
 * or loaded at runtime (debug — faster iteration, no relink on codegen change).
 */
export function codegenEmbed(cfg: Config): boolean {
  return cfg.release || cfg.ci;
}

// ───────────────────────────────────────────────────────────────────────────
// Paths
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where zig lives. Defaults to vendor/zig (gitignored), shared across
 * profiles — the commit pin is global and changing it affects everything.
 *
 * Override via $BUN_ZIG_PATH to point at an existing zig install (e.g.
 * share one compiler across worktrees, test a zig fork build, or pre-fetch
 * in an air-gapped environment). When set, the fetch edge is skipped and
 * the path must already contain a zig/ + lib/ layout. Mirrors the
 * $BUN_WEBKIT_PATH override.
 */
function zigPath(cfg: Config): string {
  const env = process.env.BUN_ZIG_PATH;
  if (!env) return resolve(cfg.vendorDir, "zig");
  // Shells don't expand ~ inside quotes; handle it here so a quoted export works.
  if (env === "~" || env.startsWith("~/") || env.startsWith("~\\")) return join(homedir(), env.slice(1));
  // Anchor relative paths to the repo root so ninja's regen rule (which runs
  // from buildDir) resolves the same path as the initial configure.
  return resolve(cfg.cwd, env);
}

function zigExecutable(cfg: Config): string {
  return resolve(zigPath(cfg), "zig" + cfg.host.exeSuffix);
}

/**
 * Zig cache directories — where zig stores incremental compilation state.
 */
function zigCacheDirs(cfg: Config): { local: string; global: string } {
  return {
    local: resolve(cfg.buildDir, "cache", "zig", "local"),
    global: resolve(cfg.cacheDir, "zig", "global"),
  };
}

/**
 * Download URL for the zig compiler binary.
 *
 * HOST os/arch, not TARGET — the compiler runs on the build machine and
 * cross-compiles via -Dtarget.
 *
 * os-abi: zig binaries are always statically linked (musl on linux, gnu
 * on windows), so the abi is fixed per-os.
 */
export function zigDownloadUrl(cfg: Config, safe: boolean): string {
  const arch = cfg.host.arch === "aarch64" ? "aarch64" : "x86_64";
  let osAbi: string;
  if (cfg.host.os === "darwin") {
    osAbi = "macos-none";
  } else if (cfg.host.os === "windows") {
    osAbi = "windows-gnu";
  } else if (cfg.host.os === "freebsd") {
    // oven-sh/zig has no FreeBSD-hosted prebuilt; native builds must use a
    // system zig via $BUN_ZIG_PATH. Cross-compile from Linux is the
    // expected path (host.os === "linux" → linux-musl below).
    throw new BuildError(
      "No prebuilt zig compiler for FreeBSD hosts — set $BUN_ZIG_PATH to a system zig, or cross-compile from Linux",
    );
  } else {
    // linux: always musl for the compiler binary (static).
    osAbi = "linux-musl";
  }

  const safeSuffix = safe ? "-ReleaseSafe" : "";
  const zipName = `bootstrap-${arch}-${osAbi}${safeSuffix}.zip`;
  return `https://github.com/oven-sh/zig/releases/download/autobuild-${cfg.zigCommit}/${zipName}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja rules
// ───────────────────────────────────────────────────────────────────────────

export function registerZigRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  // Zig fetch wrapped in stream.ts for the [zig] prefix alongside other
  // dep fetches. Fast (cache hit <100ms) so pool doesn't matter.
  const stream = `${cfg.jsRuntime} ${q(streamPath)} zig`;

  n.rule("zig_fetch", {
    command: `${stream} ${cfg.jsRuntime} ${q(fetchCliPath)} zig $url $dest $commit`,
    description: "zig download compiler",
    restat: true,
  });

  // Zig build — the big one. One invocation produces bun-zig.o (or
  // bun-zig.{0..N-1}.o when codegenThreads()>1). Zig's own build system
  // handles per-file tracking; restat prunes downstream when zig's cache
  // says nothing changed.
  //
  // Default: --console + pool=console. Zig gets direct TTY, its native
  // spinner works. Ninja defers [N/M] while the console job owns the
  // terminal, so cxx progress is hidden during zig's compile. Matches
  // the old cmake build's behavior.
  //
  // --zig-progress instead of --console (posix only, set interleave=true):
  // decodes ZIG_PROGRESS IPC into `[zig] Stage [N/M]` lines that interleave
  // with ninja's [N/M] for cxx — both visible at once. Requires
  // oven-sh/zig's fix for ziglang/zig#24722. Windows zig has no IPC in
  // our fork (upstream added Feb 2026, not backported).
  const interleave = false;
  const consoleMode = !interleave || hostWin;
  const parallelSema = " --env=ZIG_PARALLEL_SEMA=1";
  n.rule("zig_build", {
    command: `${stream} ${consoleMode ? "--console" : "--zig-progress"} --env=ZIG_LOCAL_CACHE_DIR=$zig_local_cache --env=ZIG_GLOBAL_CACHE_DIR=$zig_global_cache${parallelSema} $zig build $step $args`,
    // $out can be 16 shard paths; the build edge sets a compact $label.
    description: "zig $step → $label",
    ...(consoleMode && { pool: "console" }),
    restat: true,
  });

  // Zig semantic check — `zig build check[-*]`. Type-checks without
  // emitting object code; output is a stamp file created by --stamp so
  // ninja can track completion. Same cache dirs as the main zig build —
  // zig keys by hash, the two coexist cleanly.
  n.rule("zig_check", {
    command: `${stream} --console --stamp=$out --env=ZIG_LOCAL_CACHE_DIR=$zig_local_cache --env=ZIG_GLOBAL_CACHE_DIR=$zig_global_cache${parallelSema} $zig build $step $args`,
    description: "zig $step",
    pool: "console",
    restat: true,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Zig build emission
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inputs to the zig build step. Assembled by the caller from
 * resolved deps + emitted codegen outputs.
 */
export interface ZigBuildInputs {
  /**
   * Generated files zig needs (content tracked). From CodegenOutputs.zigInputs.
   * Changes here must trigger a zig rebuild.
   */
  codegenInputs: string[];
  /**
   * All `*.zig` source files (globbed at configure time, codegen-into-src
   * files already filtered out by caller). Implicit inputs for ninja's
   * staleness check — zig discovers sources itself, this is just so ninja
   * knows when to re-invoke.
   */
  zigSources: string[];
  /**
   * Generated files zig needs to EXIST but doesn't track content of.
   * From CodegenOutputs.zigOrderOnly — specifically the bake runtime .js
   * files in debug mode (runtime-loaded, not embedded).
   */
  codegenOrderOnly: string[];
  /**
   * zstd source fetch stamp. build.zig `@cImport`s headers from
   * vendor/zstd/lib/ directly — doesn't need zstd BUILT, just FETCHED.
   * Order-only because the headers don't change often and zig's own
   * translate-c caching handles the inner dependency.
   */
  zstdStamp: string;
}

/**
 * Emit the zig download + zig build steps. Returns the output object file(s).
 *
 * Single `bun-zig.o` when codegenThreads()<=1 (non-ASAN CI, Windows
 * targets); `bun-zig.{0..N-1}.o` shards otherwise (ASAN CI, local dev).
 * The link step spreads the returned array into its inputs either way.
 */
export function emitZig(n: Ninja, cfg: Config, inputs: ZigBuildInputs): string[] {
  n.comment("─── Zig ───");
  n.blank();

  // ─── Download compiler ───
  const zigDest = zigPath(cfg);
  const zigExe = zigExecutable(cfg);
  const envOverride = process.env.BUN_ZIG_PATH;
  if (envOverride) {
    // User-provided compiler — no fetch edge. Validate at configure time
    // that the path has a usable layout; commit mismatch is the user's
    // problem. zig build will error loudly if the compiler is too old.
    assert(existsSync(zigExe), `BUN_ZIG_PATH='${envOverride}' but no zig executable at ${zigExe}`, {
      hint: "Point $BUN_ZIG_PATH at an extracted zig install (the dir containing zig + lib/), or unset it to use the bundled compiler",
    });
    assert(existsSync(resolve(zigDest, "lib")), `BUN_ZIG_PATH='${envOverride}' but no lib/ dir at ${zigDest}`, {
      hint: "zig needs its bundled stdlib at <path>/lib/ — make sure the extract wasn't partial",
    });
  } else {
    const safe = zigCompilerSafe(cfg);
    const url = zigDownloadUrl(cfg, safe);
    // Commit + safe go into the stamp content, so switching either retriggers.
    const stamp = resolve(zigDest, ".zig-commit");

    n.build({
      outputs: [stamp],
      implicitOutputs: [zigExe],
      rule: "zig_fetch",
      inputs: [],
      // Only fetch-cli.ts. This file (zig.ts) has emitZig and other logic
      // unrelated to download — editing those shouldn't re-download the
      // compiler. The URL/commit are in the rule's vars so changing those
      // already retriggers via ninja's command tracking.
      implicitInputs: [fetchCliPath],
      vars: {
        url,
        dest: zigDest,
        // Safe is encoded in the commit stamp (not just URL) so the CLI
        // can short-circuit correctly when safe doesn't change.
        commit: `${cfg.zigCommit}${safe ? "-safe" : ""}`,
      },
    });
  }
  n.phony("zig-compiler", [zigExe]);

  // ─── Build ───
  const cacheDirs = zigCacheDirs(cfg);
  // With the parallel compiler at >1 codegen threads, build.zig sets
  // `llvm_no_merge_shards` and installs `bun-zig.{i}.o` per shard instead
  // of one merged `bun-zig.o` (zig's single-threaded ELF -r merge of the
  // shards dominated wall time). Declare every shard so ninja tracks them
  // and the link step gets all of them; lld merges in parallel.
  const outputs = zigObjectPaths(cfg);
  const args = zigBuildArgs(cfg);

  n.build({
    outputs,
    rule: "zig_build",
    inputs: [],
    implicitInputs: zigBuildImplicitInputs(cfg, inputs),
    orderOnlyInputs: zigBuildOrderOnlyInputs(inputs),
    vars: {
      zig: zigExe,
      step: "obj",
      args: quoteArgs(args, cfg.host.os === "windows"),
      zig_local_cache: cacheDirs.local,
      zig_global_cache: cacheDirs.global,
      label: outputs.length > 1 ? `bun-zig.{0..${outputs.length - 1}}.o` : "bun-zig.o",
    },
  });
  n.phony("bun-zig", outputs);
  n.blank();

  return outputs;
}

// ───────────────────────────────────────────────────────────────────────────
// Shared `zig build` invocation helpers (obj + check)
// ───────────────────────────────────────────────────────────────────────────

/**
 * `zig build` CLI args shared by both the obj build and the check steps.
 * build.zig options have `orelse` defaults, so unknown-to-a-step options
 * (e.g. -Dtarget for check-all, which sets targets internally) are ignored
 * silently — we pass them uniformly for simplicity and diffability.
 */
function zigBuildArgs(cfg: Config): string[] {
  const cacheDirs = zigCacheDirs(cfg);
  const zigDest = zigPath(cfg);
  const bool = (b: boolean): string => (b ? "true" : "false");
  return [
    // Cache and lib paths. --zig-lib-dir points at OUR bundled stdlib,
    // not any system zig — the compiler and stdlib must match commits.
    "--cache-dir",
    cacheDirs.local,
    "--global-cache-dir",
    cacheDirs.global,
    "--zig-lib-dir",
    resolve(zigDest, "lib"),
    "--prefix",
    cfg.buildDir,

    // Target/optimize/cpu
    "-Dobj_format=obj",
    `-Dtarget=${zigTarget(cfg)}`,
    `-Doptimize=${zigOptimize(cfg)}`,
    `-Dcpu=${zigCpu(cfg)}`,
    ...crossLibcArgs(cfg),

    // Feature flags
    `-Denable_logs=${bool(cfg.logs)}`,
    `-Denable_asan=${bool(cfg.zigAsan)}`,
    `-Denable_fuzzilli=${bool(cfg.fuzzilli)}`,
    `-Denable_valgrind=${bool(cfg.valgrind)}`,
    `-Denable_tinycc=${bool(cfg.tinycc)}`,
    `-Dlto=${bool(cfg.lto)}`,
    // Always ON — bun uses mimalloc as its default allocator. The flag
    // exists for experimentation; in practice it's never OFF.
    `-Duse_mimalloc=true`,
    // Sharded LLVM codegen — one shard per host core on the parallel
    // compiler. Zig has no "auto" value (0 = single-threaded). MUST be 0
    // on the stable compiler — see codegenThreads().
    `-Dllvm_codegen_threads=${codegenThreads(cfg)}`,

    // Versioning
    `-Dversion=${cfg.version}`,
    `-Dreported_nodejs_version=${cfg.nodejsVersion}`,
    `-Dcanary=${cfg.canaryRevision}`,
    `-Dcodegen_path=${cfg.codegenDir}`,
    `-Dcodegen_embed=${bool(codegenEmbed(cfg))}`,

    // Git sha (optional — empty on dirty builds).
    ...(cfg.revision !== "unknown" && cfg.revision !== "" ? [`-Dsha=${cfg.revision}`] : []),

    // Output formatting
    "--prominent-compile-errors",
    "--summary",
    "all",
  ];
}

/**
 * Implicit inputs for any zig build invocation (obj or check). Same set
 * in both cases — the compiler, build.zig, every .zig source, and every
 * codegen file zig imports or embeds.
 */
function zigBuildImplicitInputs(cfg: Config, inputs: ZigBuildInputs): string[] {
  // Extra embed: scanner-entry.ts is @embedFile'd by the zig code directly.
  // A genuinely odd cross-language embed; there's no cleaner way.
  const scannerEntry = resolve(cfg.cwd, "src", "install", "PackageManager", "scanner-entry.ts");
  return [
    // Compiler itself — rebuild on zig version bump.
    zigExecutable(cfg),
    // build.zig — the zig build script.
    resolve(cfg.cwd, "build.zig"),
    // All zig source files (codegen outputs already filtered by caller).
    ...inputs.zigSources,
    // Codegen outputs zig imports/embeds.
    ...inputs.codegenInputs,
    // The odd cross-language embed.
    scannerEntry,
  ];
}

/**
 * Order-only inputs for any zig build invocation — files that must EXIST
 * but whose content is tracked elsewhere (zig's translate-c cache, or
 * they're runtime-loaded not embedded).
 */
function zigBuildOrderOnlyInputs(inputs: ZigBuildInputs): string[] {
  return [
    // zstd headers — must exist for @cImport, but content is tracked by
    // zig's translate-c cache, not ninja.
    inputs.zstdStamp,
    // Debug-mode bake runtime — must exist at runtime-load path, but
    // zig doesn't track content (not embedded).
    ...inputs.codegenOrderOnly,
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// Zig semantic check — `zig build check[-*]`
// ───────────────────────────────────────────────────────────────────────────

/**
 * `zig build` check steps exposed as ninja targets. Each becomes a phony
 * `zig-<step>` plus a stamp file, invokable via `bun bd --target=zig-check`
 * (etc.). See build.zig for what each step covers.
 *
 * `check` type-checks the current platform (uses -Dtarget/-Dcpu). The
 * `check-*` variants iterate multiple targets internally — our -Dtarget
 * is inert for them.
 */
const CHECK_STEPS = [
  "check",
  "check-debug",
  "check-all",
  "check-all-debug",
  "check-windows",
  "check-windows-debug",
  "check-macos",
  "check-macos-debug",
  "check-linux",
  "check-linux-debug",
] as const;

/**
 * Emit one ninja edge per `zig build check[-*]` step. Each depends on
 * the same codegen + zig source set as the obj build, so users can run
 * `bun bd --target=zig-check` and ninja will rebuild any stale codegen
 * before invoking zig. Output is a stamp file (stream.ts --stamp writes
 * it on exit 0); restat lets the no-op case prune downstream.
 *
 * Assumes the zig compiler download edge (from `emitZig`) has already
 * been emitted — we depend on zigExecutable but don't re-emit the fetch.
 */
export function emitZigCheck(n: Ninja, cfg: Config, inputs: ZigBuildInputs): void {
  n.comment("─── Zig semantic check ───");
  n.blank();

  const zigExe = zigExecutable(cfg);
  const cacheDirs = zigCacheDirs(cfg);
  // `--summary new` instead of `all`: check is a fast-iteration workflow
  // (mostly cache hits), so skip the "cached" rows zig would otherwise
  // print for every unchanged step. Matches the pre-ninja `zig:check`
  // scripts. zigBuildArgs ends with `--summary all`; swap the last arg.
  const args = zigBuildArgs(cfg);
  args[args.length - 1] = "new";
  const hostWin = cfg.host.os === "windows";

  for (const step of CHECK_STEPS) {
    const stamp = resolve(cfg.buildDir, `.zig-${step}.stamp`);
    n.build({
      outputs: [stamp],
      rule: "zig_check",
      inputs: [],
      implicitInputs: zigBuildImplicitInputs(cfg, inputs),
      orderOnlyInputs: zigBuildOrderOnlyInputs(inputs),
      vars: {
        zig: zigExe,
        step,
        args: quoteArgs(args, hostWin),
        zig_local_cache: cacheDirs.local,
        zig_global_cache: cacheDirs.global,
      },
    });
    n.phony(`zig-${step}`, [stamp]);
  }
  n.blank();
}

// ───────────────────────────────────────────────────────────────────────────
// Fetch implementation — invoked by fetch-cli.ts (which ninja calls)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Download and extract the zig compiler binary.
 *
 * Idempotent: if `dest/.zig-commit` matches `commit`, exits without
 * touching anything (restat prunes).
 *
 * The zip has a single top-level dir containing {zig, lib/, doc/, ...}.
 * CMake's DownloadUrl.cmake auto-hoists single-child extractions; we do
 * the same.
 */
export async function fetchZig(url: string, dest: string, commit: string): Promise<void> {
  const stampPath = resolve(dest, ".zig-commit");

  // Short-circuit: already at this commit?
  if (existsSync(stampPath)) {
    const existing = readFileSync(stampPath, "utf8").trim();
    if (existing === commit) {
      console.log(`up to date`);
      return; // restat no-op
    }
    console.log(`commit changed (was ${existing}, now ${commit}), re-fetching`);
  }

  // Prefetch cache: pre-extracted tree with matching commit?
  if (await tryPrefetchExtracted(dest, ".zig-commit", commit)) return;

  console.log(`fetching ${url}`);

  // ─── Download ───
  const destParent = resolve(dest, "..");
  await mkdir(destParent, { recursive: true });
  const zipPath = `${dest}.download.zip`;
  await downloadWithRetry(url, zipPath, "zig");

  // ─── Extract ───
  // Wipe dest first — don't want stale files from a previous version.
  await rm(dest, { recursive: true, force: true });

  // Extract to a temp dir, then find the hoistable top-level dir.
  const extractDir = `${dest}.extract`;
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  // Use system unzip. Present on all platforms we support (Windows 10+
  // has it via PowerShell Expand-Archive, but `tar` also handles .zip
  // on bsdtar/Windows tar.exe — use that for consistency).
  //
  // -m: same mtime fix as tar (zip stores creation timestamps).
  // But wait — tar doesn't handle .zip on all platforms reliably.
  // `unzip` is more portable for .zip specifically. Check and fall back.
  await extractZip(zipPath, extractDir);
  await rm(zipPath, { force: true });

  // Hoist: zip has one top-level dir (e.g. `zig-linux-x86_64-0.14.0-...`).
  const entries = await readdir(extractDir);
  assert(entries.length > 0, `zip extracted nothing: ${zipPath}`);
  let hoistFrom: string;
  if (entries.length === 1) {
    hoistFrom = resolve(extractDir, entries[0]!);
  } else {
    // Multiple top-level entries — zip was already flat.
    hoistFrom = extractDir;
  }
  await rename(hoistFrom, dest);
  await rm(extractDir, { recursive: true, force: true });

  // ─── Validate ───
  const zigExe = resolve(dest, process.platform === "win32" ? "zig.exe" : "zig");
  assert(existsSync(zigExe), `zig executable not found after extraction: ${zigExe}`, {
    hint: "Archive layout may have changed",
  });
  assert(existsSync(resolve(dest, "lib")), `zig lib/ dir not found`, {
    hint: "Archive may be incomplete",
  });

  // ─── Editor stability symlinks (unix) ───
  // VSCode/neovim zig extensions want a stable `zig.exe`/`zls.exe` path
  // even on unix (they probe for both). Create symlinks.
  if (process.platform !== "win32") {
    try {
      symlinkSync("zig", resolve(dest, "zig.exe"));
    } catch {}
    try {
      symlinkSync("zls", resolve(dest, "zls.exe"));
    } catch {}
  }

  // ─── Write stamp ───
  await writeFile(stampPath, commit + "\n");
  console.log(`extracted to ${dest}`);
}
