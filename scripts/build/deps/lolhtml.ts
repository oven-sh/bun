/**
 * lol-html — Cloudflare's streaming HTML rewriter. Powers `HTMLRewriter` in
 * bun and Workers. Rust crate with C FFI bindings.
 *
 * This is the only cargo-built dep. The C API crate lives under `c-api/`;
 * the root is the pure-rust library (which we don't use directly).
 */

import type { Config } from "../config.ts";
import type { CargoBuild, Dependency } from "../source.ts";

const LOLHTML_COMMIT = "77127cd2b8545998756e8d64e36ee2313c4bb312";

/**
 * -Zbuild-std requires an explicit --target even when host == target.
 * Derive the Rust triple for the build target. Windows handled separately
 * (buildStd is unix-only). Android sets rustTarget explicitly below.
 */
function rustTargetTriple(cfg: Config): string {
  const arch = cfg.arm64 ? "aarch64" : "x86_64";
  if (cfg.darwin) return `${arch}-apple-darwin`;
  if (cfg.freebsd) return `${arch}-unknown-freebsd`;
  if (cfg.abi === "musl") return `${arch}-unknown-linux-musl`;
  return `${arch}-unknown-linux-gnu`;
}

export const lolhtml: Dependency = {
  name: "lolhtml",
  versionMacro: "LOLHTML",

  source: () => ({
    kind: "github-archive",
    repo: "cloudflare/lol-html",
    commit: LOLHTML_COMMIT,
  }),

  build: cfg => {
    const spec: CargoBuild = {
      kind: "cargo",
      manifestDir: "c-api",
      libName: "lolhtml",
    };

    // On non-Windows we tell rustc to optimize for size and disable unwinding.
    // lol-html doesn't catch_unwind anywhere, and the FFI boundary is already
    // abort-on-panic (C can't unwind rust frames safely). Dropping unwind
    // tables saves ~200KB and force-unwind-tables=no is the knob for that.
    //
    // Windows REQUIRES unwind tables for SEH — the OS loader refuses to run
    // binaries without them on 64-bit. So this is unix-only.
    if (!cfg.windows) {
      spec.rustflags = ["-Cpanic=abort", "-Cdebuginfo=0", "-Cforce-unwind-tables=no", "-Copt-level=s"];
    }

    // arm64-windows: cargo defaults to the host triple, but CI builds arm64
    // windows binaries on x64 runners. Explicit triple forces the cross-compile.
    // (x64-windows doesn't need this — host IS target.)
    if (cfg.windows && cfg.arm64) {
      spec.rustTarget = "aarch64-pc-windows-msvc";
    }

    // Android: always a cross-compile. Static lib only, so cargo needs ar
    // (any llvm-ar works) but no linker.
    if (cfg.abi === "android") {
      spec.rustTarget = cfg.arm64 ? "aarch64-linux-android" : "x86_64-linux-android";
    }

    // FreeBSD aarch64 is Tier 3 — no prebuilt std, so -Zbuild-std is
    // required regardless of release/debug.
    if (cfg.freebsd && cfg.arm64) {
      spec.buildStd = true;
    }

    // -Cpanic=abort alone still links the *precompiled* std, whose
    // __rust_start_panic prints a backtrace before aborting — pulling in
    // gimli/addr2line/rustc_demangle/miniz_oxide (~230 KB). For release,
    // rebuild std with -Cpanic=immediate-abort so panic is a bare abort().
    // Requires nightly + rust-src; only enable where CI's Rust toolchain is
    // known to have both and -Zbuild-std for the target is verified
    // (linux-gnu, darwin, freebsd). musl/android keep the prebuilt-std
    // -Cpanic=abort path.
    const canBuildStdImmediateAbort =
      cfg.darwin || cfg.freebsd || (cfg.linux && cfg.abi !== "musl" && cfg.abi !== "android");
    if (cfg.release && canBuildStdImmediateAbort) {
      spec.buildStd = true;
      spec.rustflags = [
        "-Zunstable-options",
        "-Cpanic=immediate-abort",
        "-Cdebuginfo=0",
        "-Cforce-unwind-tables=no",
        "-Copt-level=s",
      ];
    }

    // -Zbuild-std and cross-compiles both need an explicit --target.
    // Android/Windows set theirs above; ??= preserves those. For native
    // non-buildStd builds (musl, debug gnu) leaving rustTarget unset is fine
    // — cargo defaults to the host triple and source.ts uses the simpler
    // output dir.
    if (spec.buildStd || cfg.crossTarget !== undefined) {
      spec.rustTarget ??= rustTargetTriple(cfg);
    }

    return spec;
  },

  provides: () => ({
    // CargoBuild.libName handles the output path; provides.libs is not
    // consulted for cargo deps (emitCargo constructs the path directly).
    // We still list it for clarity.
    libs: ["lolhtml"],
    // No includes — bun's c-api binding header is checked into
    // src/bun.js/bindings/, not read from the crate.
    includes: [],
  }),
};
