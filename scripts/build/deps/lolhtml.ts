/**
 * lol-html — Cloudflare's streaming HTML rewriter. Powers `HTMLRewriter` in
 * bun and Workers.
 *
 * Unlike the other vendored deps this is NOT built into its own archive.
 * A Rust `staticlib` bundles a private copy of `std`; linking that next to
 * bun's own Rust crates gives the linker two copies of every unmangled std
 * symbol (`rust_begin_unwind`, `__rdl_alloc`, ...). Instead the `lol_html` crate (`vendor/lolhtml/Cargo.toml`) is a direct Rust path
 * dependency of `bun_runtime`/`bun_bundler`
 * (`lol_html = { path = "vendor/lolhtml" }` in the workspace `Cargo.toml`),
 * so it compiles as an rlib in the one workspace crate graph and is linked
 * like any other crate. There is no C FFI layer; the
 * upstream `c-api/` sub-crate is fetched along with the rest of the source
 * but never built.
 *
 * This dep entry exists only to FETCH the source into `vendor/lolhtml/` —
 * `emitRust` in `rust.ts` waits on its `.ref` stamp so cargo never sees a
 * missing path dependency.
 */

import type { Dependency } from "../source.ts";

// oven-sh/lol-html is cloudflare/lol-html plus content-handler suspension
// (`HtmlRewriter::resume()`), `:not()` matching that follows De Morgan's laws
// (oven-sh/lol-html#9) and open-name counts that exist only on a deep stack
// (oven-sh/lol-html#11), maintained on the `bun` branch. The upstream
// base commit is recorded here so a rebase onto a new upstream tag is
// `git rebase --onto <new-tag> <LOLHTML_UPSTREAM_BASE> bun` in the fork.
const LOLHTML_UPSTREAM_BASE = "608cc4a66b7ab4fcbe1bbdeb25df8f265572b11c"; // v3.0.1
const LOLHTML_COMMIT = "0e6a4b19c483b9897a57986973b4424788dc5a2a";
void LOLHTML_UPSTREAM_BASE;

export const lolhtml: Dependency = {
  name: "lolhtml",
  versionMacro: "LOLHTML",

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/lol-html",
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
