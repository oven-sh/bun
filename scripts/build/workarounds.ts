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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { LIBUV_COMMIT } from "./deps/libuv.ts";
import { BuildError } from "./error.ts";
import { satisfiesRange, toolchainOverride } from "./tools.ts";

/** Read a crate's locked version out of the repo's Cargo.lock. */
function lockedCrateVersion(cfg: Config, name: string): string | undefined {
  const lock = readFileSync(join(cfg.cwd, "Cargo.lock"), "utf8");
  const m = lock.match(new RegExp(`\\nname = "${name}"\\nversion = "([^"]+)"`));
  return m?.[1];
}

// The upstream merge commit is not known yet. Treat the next libuv bump as
// the point to remove the patch or deliberately advance this baseline.
const LIBUV_COMMIT_WITHOUT_CLOSE_CRT_ASSERT_FIX = "8023581113b276e7c1aee3f82da57ca0893faab1";

export function isLibuvCloseCrtAssertPatchObsolete(commit: string): boolean {
  return commit !== LIBUV_COMMIT_WITHOUT_CLOSE_CRT_ASSERT_FIX;
}

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
    id: "libuv-win-close-crt-assert",
    issue: "https://github.com/libuv/libuv/pull/5237",
    description:
      "libuv's Windows close path does not suppress debug CRT assertion dialogs for invalid file descriptors",
    applies: cfg => cfg.windows,
    expectedToBeFixed: _cfg => isLibuvCloseCrtAssertPatchObsolete(LIBUV_COMMIT),
    cleanup:
      `Delete patches/libuv/win-close-disable-crt-assert.patch, remove it from the patches array in ` +
      `scripts/build/deps/libuv.ts, and delete this entry.`,
  },
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
    id: "rust-lld-for-crosslang-lto",
    issue: "https://rustc-dev-guide.rust-lang.org/backend/updating-llvm.html",
    description:
      "rustc's bundled LLVM is newer than clang's, so clang's ld.lld can't read " +
      "-Clinker-plugin-lto bitcode (forward-compatible only). Link with rust-lld instead " +
      "(and compress ELF debug sections post-link via llvm-objcopy, since rust-lld lacks zlib).",
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
    id: "darwin-cross-stack-size",
    issue:
      "https://github.com/llvm/llvm-project/blob/main/lld/MachO/Driver.cpp (OPT_stack_size in unimplemented warnings)",
    description:
      "ld64.lld parses `-stack_size` but doesn't implement it (\"is not yet implemented. Stay " +
      'tuned..."), so darwin cross links keep the 8 MB default main-thread stack instead of the ' +
      "18 MB JSC needs. shims/macho-postlink.c patches LC_MAIN.stacksize after the link instead.",
    applies: cfg => cfg.darwin && cfg.crossTarget !== undefined,
    expectedToBeFixed: cfg => {
      // Not implemented as of LLVM 21 (lld/MachO/Driver.cpp keeps
      // OPT_stack_size in the "unimplemented, warn and ignore" list).
      // Re-test when the toolchain moves to LLVM 23: link a darwin cross
      // build and check whether `ld64.lld ... -stack_size 0x1200000` still
      // prints "is not yet implemented". If it does, bump this threshold.
      // (A configure-time probe that spawned ld64.lld was tried first and
      // reverted: the rust/cpp split steps configure on machines whose
      // ld64.lld doesn't behave like the link machine's, and a probe that
      // misfires there fails the whole lane.)
      const FIXED_IN_LLVM = "23.0.0";
      return cfg.clangVersion !== undefined && satisfiesRange(cfg.clangVersion, `>=${FIXED_IN_LLVM}`);
    },
    cleanup:
      `Drop the --stack-size argument from machoPostlinkCommand() in scripts/build/shims.ts and ` +
      `this entry. Keep macho-postlink.c itself — it still owns the entitlements embedding and ` +
      `the post-edit re-sign.`,
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
  {
    id: "android-posix-spawn-setsid-const",
    issue: "https://github.com/rust-lang/libc/pull/5104",
    description:
      "The libc crate doesn't expose POSIX_SPAWN_SETSID for target_os = android, so the " +
      "linux+android cfg arm in spawn_sys hardcodes 0x80 (the value glibc/musl/bionic share).",
    // Cleanup is a source-code change, not a build-config change — once
    // Cargo.lock's libc has the constant, the local 0x80 can go regardless
    // of which target is being built. Gate to android so the threshold-bump
    // hint doesn't bother host-only builds.
    applies: cfg => cfg.abi === "android",
    expectedToBeFixed: cfg => {
      // PR #5104 targets `main` with `stable-nominated`; a 0.2.x cherry-pick
      // follows. Best guess for the first 0.2.x with it — bump if the
      // constant isn't actually there yet.
      const FIXED_IN_LIBC = "0.2.187";
      const v = lockedCrateVersion(cfg, "libc");
      return v !== undefined && satisfiesRange(v, `>=${FIXED_IN_LIBC}`);
    },
    cleanup:
      `In src/spawn_sys/posix_spawn.rs (Attr::set) and src/spawn_sys/spawn_process.rs ` +
      `(options.detached block), replace the local 0x80 with libc::POSIX_SPAWN_SETSID, ` +
      `drop the explanatory comments, and delete this entry.`,
  },
];

/**
 * Check every workaround. Throws if any is obsolete on the current config.
 * Call from configure.ts after Config is fully resolved.
 */
export function checkWorkarounds(cfg: Config): void {
  // Expiry thresholds are written against the pinned toolchains. With an
  // explicitly supplied one (BUN_TOOLCHAIN_LLVM / BUN_TOOLCHAIN_RUST), which may
  // be newer than the pin, an expired workaround is reported, not fatal.
  const overridden = toolchainOverride.llvm !== undefined || toolchainOverride.rust !== undefined;
  for (const w of workarounds) {
    if (!w.applies(cfg)) continue;
    if (!w.expectedToBeFixed(cfg)) continue;

    const title = `Workaround '${w.id}' is obsolete — upstream fix is available`;
    const hint =
      `${w.description}\n` +
      `  Tracked: ${w.issue}\n\n` +
      `${w.cleanup}\n\n` +
      `If the issue still reproduces, bump the threshold in expectedToBeFixed() in scripts/build/workarounds.ts instead.`;
    if (overridden) {
      console.warn(`note: ${title} (with the overridden toolchain)\n${hint}\n`);
      continue;
    }
    throw new BuildError(title, { hint });
  }
}
