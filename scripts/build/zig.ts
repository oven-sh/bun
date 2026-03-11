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
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { downloadWithRetry, extractZip } from "./download.ts";
import { assert } from "./error.ts";
import { fetchCliPath } from "./fetch-cli.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs } from "./shell.ts";
import { streamPath } from "./stream.ts";

/**
 * Zig compiler commit — determines compiler download + bundled stdlib.
 * Override via `--zig-commit=<hash>` to test a new compiler.
 * From https://github.com/oven-sh/zig releases.
 */
export const ZIG_COMMIT = "c031cbebf5b063210473ff5204a24ebfb2492c72";

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
  // linux: abi is always set (resolveConfig asserts)
  assert(cfg.abi !== undefined, "linux build missing abi");
  return `${arch}-linux-${cfg.abi}`;
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
 * Where zig lives. In vendor/ (gitignored), shared across profiles — the
 * commit pin is global and changing it affects everything.
 */
function zigPath(cfg: Config): string {
  return resolve(cfg.vendorDir, "zig");
}

function zigExecutable(cfg: Config): string {
  // Host suffix — zig runs on the host. cfg.exeSuffix is target
  // (windows target → .exe), wrong for cross-compile from linux.
  const suffix = cfg.host.os === "windows" ? ".exe" : "";
  return resolve(zigPath(cfg), "zig" + suffix);
}

/**
 * Zig cache directories — where zig stores incremental compilation state.
 */
function zigCacheDirs(cfg: Config): { local: string; global: string } {
  return {
    local: resolve(cfg.cacheDir, "zig", "local"),
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
function zigDownloadUrl(cfg: Config, safe: boolean): string {
  const arch = cfg.host.arch === "aarch64" ? "aarch64" : "x86_64";
  let osAbi: string;
  if (cfg.host.os === "darwin") {
    osAbi = "macos-none";
  } else if (cfg.host.os === "windows") {
    osAbi = "windows-gnu";
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
  const bun = q(cfg.bun);

  // Zig fetch wrapped in stream.ts for the [zig] prefix alongside other
  // dep fetches. Fast (cache hit <100ms) so pool doesn't matter.
  const stream = `${bun} ${q(streamPath)} zig`;

  n.rule("zig_fetch", {
    command: `${stream} ${bun} ${q(fetchCliPath)} zig $url $dest $commit`,
    description: "zig download compiler",
    restat: true,
  });

  // Zig build — the big one. One invocation produces bun-zig.o. Zig's
  // own build system handles per-file tracking; restat prunes downstream
  // when zig's cache says nothing changed.
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
  n.rule("zig_build", {
    command: `${stream} ${consoleMode ? "--console" : "--zig-progress"} --env=ZIG_LOCAL_CACHE_DIR=$zig_local_cache --env=ZIG_GLOBAL_CACHE_DIR=$zig_global_cache $zig build $step $args`,
    description: "zig $step → $out",
    ...(consoleMode && { pool: "console" }),
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
 * For normal builds: one `bun-zig.o`. For test builds (future): `bun-test.o`.
 * Threaded codegen (LLVM_ZIG_CODEGEN_THREADS > 1) would produce multiple .o
 * files, but that's always 0 in practice — deferred.
 */
export function emitZig(n: Ninja, cfg: Config, inputs: ZigBuildInputs): string[] {
  n.comment("─── Zig ───");
  n.blank();

  // ─── Download compiler ───
  const zigDest = zigPath(cfg);
  const zigExe = zigExecutable(cfg);
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
  n.phony("zig-compiler", [zigExe]);

  // ─── Build ───
  const cacheDirs = zigCacheDirs(cfg);
  const output = resolve(cfg.buildDir, "bun-zig.o");

  // Extra embed: scanner-entry.ts is @embedFile'd by the zig code directly.
  // A genuinely odd cross-language embed; there's no cleaner way.
  const scannerEntry = resolve(cfg.cwd, "src", "install", "PackageManager", "scanner-entry.ts");

  // ─── Build args ───
  // One -D per feature flag. Each maps directly to a build.zig option.
  // Order doesn't matter but we keep it the same as CMake for easy diffing.
  const bool = (b: boolean): string => (b ? "true" : "false");
  const args: string[] = [
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

    // Feature flags
    `-Denable_logs=${bool(cfg.logs)}`,
    `-Denable_asan=${bool(cfg.zigAsan)}`,
    `-Denable_fuzzilli=${bool(cfg.fuzzilli)}`,
    `-Denable_valgrind=${bool(cfg.valgrind)}`,
    `-Denable_tinycc=${bool(cfg.tinycc)}`,
    // Always ON — bun uses mimalloc as its default allocator. The flag
    // exists for experimentation; in practice it's never OFF.
    `-Duse_mimalloc=true`,
    // Not using threaded codegen — always 0.
    `-Dllvm_codegen_threads=0`,

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

  n.build({
    outputs: [output],
    rule: "zig_build",
    inputs: [],
    implicitInputs: [
      // Compiler itself — rebuild on zig version bump.
      zigExe,
      // build.zig — the zig build script.
      resolve(cfg.cwd, "build.zig"),
      // All zig source files (codegen outputs already filtered by caller).
      ...inputs.zigSources,
      // Codegen outputs zig imports/embeds.
      ...inputs.codegenInputs,
      // The odd cross-language embed.
      scannerEntry,
    ],
    orderOnlyInputs: [
      // zstd headers — must exist for @cImport, but content is tracked by
      // zig's translate-c cache, not ninja.
      inputs.zstdStamp,
      // Debug-mode bake runtime — must exist at runtime-load path, but
      // zig doesn't track content (not embedded).
      ...inputs.codegenOrderOnly,
    ],
    vars: {
      zig: zigExe,
      step: "obj",
      args: quoteArgs(args, cfg.host.os === "windows"),
      zig_local_cache: cacheDirs.local,
      zig_global_cache: cacheDirs.global,
    },
  });
  n.phony("bun-zig", [output]);
  n.blank();

  return [output];
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
