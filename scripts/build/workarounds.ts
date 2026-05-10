/**
 * Self-obsoleting workaround registry.
 *
 * Workarounds accumulate as dead code because nobody remembers to remove
 * them once the upstream fix ships. This file is the antidote: every
 * workaround registers an `expectedToBeFixed` predicate that trips once the
 * fix is available, and configure fails with cleanup instructions.
 *
 * Add an entry here whenever you land a workaround that's waiting on an
 * upstream release (LLVM fix, macOS update, Zig release, vendored dep
 * bump, etc.). The entry is the reminder.
 *
 * ## Writing an `expectedToBeFixed` predicate
 *
 * Typically a version check: `cfg.clangVersion >= FIXED_IN_LLVM`,
 * macOS SDK version, a dep's commit hash, etc. When you know exactly
 * which release has the fix, use that. When you don't — fix merged
 * upstream but not released yet — pick your best guess for the likely
 * release. The check might trip on a version that turns out not to
 * have the fix; that's okay. The error message tells the dev to bump
 * the threshold, which takes 30 seconds. That's cheaper than leaving
 * the check blank and the workaround living forever.
 *
 *   - Use `applies` to gate the check to configs where the workaround is
 *     actually exercised — no point failing a Linux build for a
 *     macOS-only workaround.
 *   - Tool/OS detection: if you can't reliably detect (e.g. Apple clang
 *     vs LLVM clang have different version schemes), exclude the
 *     ambiguous case.
 */

import type { Config } from "./config.ts";
import { BuildError } from "./error.ts";
import { satisfiesRange } from "./tools.ts";

export interface Workaround {
  /** Short slug — shows up in the error message. */
  id: string;
  /** Upstream tracker reference (issue URL, PR number, etc.). */
  issue: string;
  /** One-line: what's being worked around. */
  description: string;
  /**
   * Gate the check to relevant configs. If false, `expectedToBeFixed` isn't
   * evaluated — the workaround isn't exercised on this config so there's
   * nothing to verify.
   */
  applies: (cfg: Config) => boolean;
  /**
   * Return true once the upstream fix is available in the current
   * toolchain/environment. Configure fails when this trips.
   */
  expectedToBeFixed: (cfg: Config) => boolean;
  /** What to remove once the fix ships. */
  cleanup: string;
}

export const workarounds: Workaround[] = [
  {
    id: "asan-dyld-shim",
    issue: "https://github.com/llvm/llvm-project/issues/182943",
    description:
      "macOS 26.4 Dyld.framework reimplemented dyld_shared_cache_iterate_text in Swift; " +
      "the _Block_copy allocation deadlocks ASAN init re-entrantly",
    applies: cfg => cfg.darwin && cfg.asan,
    expectedToBeFixed: cfg => {
      // Fix merged to LLVM main. Backport to release/22.x is
      // https://github.com/llvm/llvm-project/pull/188913 — lower this
      // threshold to the exact 22.1.x once it lands. Apple clang is
      // already excluded: resolveLlvmToolchain only accepts Homebrew
      // llvm (LLVM_VERSION_RANGE is >=21 <23), so cfg.clangVersion is
      // always LLVM clang's version here.
      const FIXED_IN_LLVM = "22.1.4";
      return cfg.clangVersion !== undefined && satisfiesRange(cfg.clangVersion, `>=${FIXED_IN_LLVM}`);
    },
    cleanup: `Delete scripts/build/shims/asan-dyld-shim.c, scripts/build/shims.ts, the emitShims() calls in bun.ts, registerShimRules in rules.ts, and this entry.`,
  },
  {
    id: "globalopt-crash-aarch64-musl",
    issue: "https://github.com/llvm/llvm-project/issues/ (file once reduced; see CI #53109)",
    description:
      "rust-lld's link-stage LTO segfaults in the `globalopt` pass on the bun_runtime " +
      "bitcode module on aarch64-unknown-linux-musl. Disable cross-language LTO for " +
      "that target only — both halves still LTO independently (C++ via -flto=full, " +
      'Rust via [profile.release] lto = "fat"); only Rust↔C++ inlining is lost.',
    // Only exercised on the lane the crash hits.
    applies: cfg => cfg.lto && cfg.arm64 && cfg.abi === "musl",
    expectedToBeFixed: cfg => {
      // The crash is inside rust-lld's LLVM (rustc nightly-2026-05-06 ⇒ LLVM 22).
      // Re-test once the pinned rustc moves to LLVM 23. If it still crashes,
      // bump this and file the upstream LLVM issue with a reduced repro
      // (`llvm-reduce` over the bun_runtime cgu bitcode).
      const FIXED_IN_RUST_LLVM = "23.0.0";
      return cfg.rustLlvmVersion !== undefined && satisfiesRange(cfg.rustLlvmVersion, `>=${FIXED_IN_RUST_LLVM}`);
    },
    cleanup:
      `Delete the \`!(aarch64 && abi === "musl")\` clause from the \`crossLangLto\` ` +
      `derivation in resolveConfig() (config.ts), and this entry. The \`crossLangLto\` ` +
      `field itself can stay (collapses to \`= lto\` when no per-target gates remain).`,
  },
  {
    id: "rust-lld-for-crosslang-lto",
    issue: "https://rustc-dev-guide.rust-lang.org/backend/updating-llvm.html",
    description:
      "rustc's bundled LLVM is newer than clang's, so clang's ld.lld can't read " +
      "-Clinker-plugin-lto bitcode (forward-compatible only). Link with rust-lld instead.",
    applies: cfg => cfg.crossLangLto && cfg.rustLlvmVersion !== undefined && cfg.clangVersion !== undefined,
    expectedToBeFixed: cfg => {
      // Obsolete once clang's LLVM major catches up to (or passes) rustc's —
      // at that point clang's own ld.lld reads rustc's bitcode and the
      // rust-lld swap in resolveConfig() never fires.
      const clangMajor = Number(cfg.clangVersion!.split(".")[0]);
      const rustMajor = Number(cfg.rustLlvmVersion!.split(".")[0]);
      return clangMajor >= rustMajor;
    },
    cleanup:
      `Delete the rust-lld swap block in resolveConfig() (config.ts), findRustLld() and its call ` +
      `in resolveLlvmToolchain() (tools.ts), the rustLld/rustLlvmVersion fields on Toolchain/Config, ` +
      `and this entry.`,
  },
  {
    id: "rust-lld-musl-crt-zlib",
    issue: "https://github.com/rust-lang/rust/issues/data-compression-not-enabled",
    description:
      "rust-lld is built without LLVM_ENABLE_ZLIB. Alpine's musl CRT objects ship with " +
      "ELFCOMPRESS_ZLIB debug sections, which rust-lld rejects at input parse time. " +
      "Decompress them via objcopy and prepend a -B search path.",
    // Only exercised when the rust-lld swap actually fired on a musl link.
    applies: cfg => cfg.linux && cfg.abi === "musl" && cfg.rustLld !== undefined && cfg.ld === cfg.rustLld,
    expectedToBeFixed: cfg => {
      // Obsolete the same instant the rust-lld swap above is — once clang's
      // ld.lld (built with zlib) reads rustc's bitcode, we never select
      // rust-lld and the compressed CRTs are a non-issue.
      const clangMajor = Number(cfg.clangVersion!.split(".")[0]);
      const rustMajor = Number(cfg.rustLlvmVersion!.split(".")[0]);
      return clangMajor >= rustMajor;
    },
    cleanup:
      `Delete needsMuslCrtDecompress(), MUSL_CRT_OBJECTS, the shim_crt_decompress rule, and the ` +
      `musl block in emitShims() (scripts/build/shims.ts), and this entry.`,
  },
];

/**
 * Check every workaround. Throws if any is obsolete on the current config.
 * Call from configure.ts after Config is fully resolved.
 */
export function checkWorkarounds(cfg: Config): void {
  for (const w of workarounds) {
    if (!w.applies(cfg)) continue;
    if (!w.expectedToBeFixed(cfg)) continue;

    throw new BuildError(`Workaround '${w.id}' is obsolete — upstream fix is available`, {
      hint:
        `${w.description}\n` +
        `  Tracked: ${w.issue}\n\n` +
        `${w.cleanup}\n\n` +
        `If the issue still reproduces, bump the threshold in expectedToBeFixed() in scripts/build/workarounds.ts instead.`,
    });
  }
}
