/**
 * lol-html — Cloudflare's streaming HTML rewriter. Powers `HTMLRewriter` in
 * bun and Workers. Rust crate with C FFI bindings.
 *
 * Unlike the other vendored deps this is NOT built into its own archive.
 * A Rust `staticlib` bundles a private copy of `std`; linking that next to
 * `libbun_rust.a` (also a `staticlib`) gives the linker two copies of every
 * unmangled std symbol (`rust_begin_unwind`, `__rdl_alloc`, ...). Instead the
 * C-API crate is compiled as an rlib path dependency of `bun_lolhtml_sys`
 * inside the ONE workspace cargo build, so all `lol_html_*` symbols end up
 * inside `libbun_rust.a` directly.
 *
 * This dep entry remains only to FETCH the source into `vendor/lolhtml/` —
 * `emitRust` in `rust.ts` waits on its `.ref` stamp so cargo never sees a
 * missing path dependency.
 */

import type { Dependency } from "../source.ts";

const LOLHTML_COMMIT = "77127cd2b8545998756e8d64e36ee2313c4bb312";

export const lolhtml: Dependency = {
  name: "lolhtml",
  versionMacro: "LOLHTML",

  source: () => ({
    kind: "github-archive",
    repo: "cloudflare/lol-html",
    commit: LOLHTML_COMMIT,
  }),

  // Drop staticlib/cdylib outputs — we only need the rlib (saves a wasted
  // link step and avoids `-Clinker-plugin-lto` tripping over BFD ld).
  patches: ["patches/lolhtml/0001-rlib-only.patch"],

  // No separate build — compiled as part of the workspace cargo build via
  // `bun_lolhtml_sys`'s path dep on `vendor/lolhtml/c-api`.
  build: () => ({ kind: "none" }),

  provides: () => ({
    // No standalone archive on the link line.
    libs: [],
    // No includes — bun's c-api binding header is checked into
    // src/jsc/bindings/, not read from the crate.
    includes: [],
  }),
};
