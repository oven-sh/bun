/**
 * lol-html — Cloudflare's streaming HTML rewriter. Powers `HTMLRewriter` in
 * bun and Workers.
 *
 * Unlike the other vendored deps this is NOT built into its own archive.
 * A Rust `staticlib` bundles a private copy of `std`; linking that next to
 * `libbun_rust.a` (also a `staticlib`) gives the linker two copies of every
 * unmangled std symbol (`rust_begin_unwind`, `__rdl_alloc`, ...). Instead
 * the `lol_html` crate (`vendor/lolhtml/Cargo.toml`) is a direct Rust path
 * dependency of `bun_runtime`/`bun_bundler`
 * (`lol_html = { path = "vendor/lolhtml" }` in the workspace `Cargo.toml`),
 * so it compiles as an rlib inside the ONE workspace cargo build and lands
 * in `libbun_rust.a` like any other crate. There is no C FFI layer; the
 * upstream `c-api/` sub-crate is fetched along with the rest of the source
 * but never built.
 *
 * This dep entry exists only to FETCH the source into `vendor/lolhtml/` —
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

  // No separate build — compiled as part of the workspace cargo build via
  // `bun_runtime`/`bun_bundler`'s path dep on `vendor/lolhtml`.
  build: () => ({ kind: "none" }),

  provides: () => ({
    // No standalone archive on the link line.
    libs: [],
    // No includes — lol_html has no C/C++ surface; it's a pure Rust crate
    // cargo consumes straight out of `vendor/lolhtml/`.
    includes: [],
  }),
};
