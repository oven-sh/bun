/**
 * lol-html — Cloudflare's streaming HTML rewriter. Powers `HTMLRewriter` in
 * bun and Workers. Rust crate with C FFI bindings.
 *
 * This is the only cargo-built dep. The C API crate lives under `c-api/`;
 * the root is the pure-rust library (which we don't use directly).
 */

import type { CargoBuild, Dependency } from "../source.ts";

const LOLHTML_COMMIT = "e3aa54798602dd27250fafde1b5a66f080046252";

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
