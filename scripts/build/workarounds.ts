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
import { cares } from "./deps/cares.ts";
import { BuildError } from "./error.ts";
import { satisfiesRange, toolchainOverride } from "./tools.ts";

/** Read a crate's locked version out of the repo's Cargo.lock. */
function lockedCrateVersion(cfg: Config, name: string): string | undefined {
  const lock = readFileSync(join(cfg.cwd, "Cargo.lock"), "utf8");
  const m = lock.match(new RegExp(`\\nname = "${name}"\\nversion = "([^"]+)"`));
  return m?.[1];
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
    id: "darwin-cross-stack-size",
    issue:
      "https://github.com/llvm/llvm-project/blob/main/lld/MachO/Driver.cpp (OPT_stack_size in unimplemented warnings)",
    description:
      "ld64.lld parses `-stack_size` but doesn't implement it (\"is not yet implemented. Stay " +
      'tuned..."), so darwin cross links keep the 8 MB default main-thread stack instead of the ' +
      "18 MB JSC needs. shims/macho-postlink.c patches LC_MAIN.stacksize after the link instead.",
    applies: cfg => cfg.darwin && cfg.crossTarget !== undefined,
    expectedToBeFixed: cfg => {
      // Not implemented as of LLVM 23.1.1, nor on llvm main in 2026-09:
      // lld/MachO/Options.td still marks stack_size `HelpHidden`, which
      // Driver.cpp's warnIfUnimplementedOption() reports as "is not yet
      // implemented" and ignores. Re-check that flag at the next LLVM bump;
      // if it is still there, bump this threshold again.
      // (A configure-time probe that spawned ld64.lld was tried first and
      // reverted: the rust/cpp split steps configure on machines whose
      // ld64.lld doesn't behave like the link machine's, and a probe that
      // misfires there fails the whole lane.)
      const FIXED_IN_LLVM = "24.0.0";
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
      // Only matters while the rust-lld swap in resolveConfig() fires, i.e.
      // while rustc's LLVM major is ahead of clang's — when clang's ld.lld
      // (built with zlib) reads rustc's bitcode, rust-lld is never selected
      // and the compressed CRTs are a non-issue.
      return !cfg.rustLlvmNewer;
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
  {
    id: "cares-dead-deferred-conn-close",
    issue: "https://github.com/c-ares/c-ares/pull/1138 (introduced it in 1.34.7; no upstream issue as of 2026-09)",
    description:
      "c-ares never reaches the deferred connection close in process_read(): read_answers() " +
      "returns ARES_EBADRESP whenever its buffer runs out. A TCP answer that is cut short then " +
      "spins the event loop until the query times out. " +
      "patches/cares/close-tcp-conn-on-partial-answer.patch does the close in read_answers().",
    applies: () => true,
    expectedToBeFixed: cfg => {
      // Nothing upstream to key a version on yet, so every c-ares bump asks
      // for a re-check. Set this to the new pin if the bug is still there.
      const CHECKED_AT_CARES_COMMIT = "c7a3138dcfe3bb0eaaf10c0c24c36dc66dc790ab";
      const source = cares.source(cfg);
      return source.kind === "github-archive" && source.commit !== CHECKED_AT_CARES_COMMIT;
    },
    cleanup:
      `Remove the patch from the patches list in scripts/build/deps/cares.ts and run ` +
      `test/js/node/dns/dns-tcp-partial-answer.test.ts. If it passes, upstream fixed it: delete ` +
      `patches/cares/close-tcp-conn-on-partial-answer.patch and this entry. If it fails with ` +
      `ETIMEOUT, keep the patch and update CHECKED_AT_CARES_COMMIT in this entry.`,
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
