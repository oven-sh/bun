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
