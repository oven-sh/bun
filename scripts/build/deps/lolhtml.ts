/**
 * lol-html — Cloudflare's streaming HTML rewriter. Powers `HTMLRewriter` in
 * bun and Workers. Rust crate with C FFI bindings.
 *
 * This is the only cargo-built dep. The C API crate lives under `c-api/`;
 * the root is the pure-rust library (which we don't use directly).
 */

import type { CargoBuild, Dependency } from "../source.ts";

const LOLHTML_COMMIT = "77127cd2b8545998756e8d64e36ee2313c4bb312";

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

    // FreeBSD: cross-compile when crossTarget is set (host != freebsd).
    // x86_64 is Tier 2 (prebuilt std). aarch64 is Tier 3 — no prebuilt, so
    // build std from source via -Zbuild-std (requires nightly + rust-src).
    if (cfg.freebsd && cfg.crossTarget !== undefined) {
      spec.rustTarget = cfg.arm64 ? "aarch64-unknown-freebsd" : "x86_64-unknown-freebsd";
      spec.buildStd = cfg.arm64;
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
