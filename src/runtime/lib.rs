#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// PORTING.md crate map says `bun.String`/`bun.strings` → `bun_str`, but the
// workspace crate is named `bun_string`. Alias once here so draft modules that
// followed the guide compile without per-file edits.
extern crate bun_string as bun_str;

/// `crate::jsc` is now a thin re-export of the real `bun_jsc` crate. Draft
/// modules that imported `crate::jsc::…` (instead of `bun_jsc::…`) continue to
/// resolve unchanged.
pub mod jsc {
    pub use bun_jsc::*;
}

// ─── un-gated in B-2 (heavy submodules re-gated inside each file) ────────
pub mod crypto;
pub mod server;
pub mod ffi;
pub mod socket;
#[path = "webcore.rs"]
pub mod webcore;
#[path = "node.rs"]
pub mod node;

pub mod bake;
pub mod shell;
pub mod cli;
pub mod napi;
#[path = "api.rs"]
pub mod api;
pub mod timer;
pub mod dispatch;

// Newly declared in B-2 (was in the "unwired" list).
pub mod image {
    #[path = "thumbhash.rs"]
    pub mod thumbhash;
    #[path = "quantize.rs"]
    pub mod quantize;
    #[path = "exif.rs"]
    pub mod exif;
    // Remaining image submodules (codec_*, Image, codecs, backend_*) depend on
    // bun_jsc / FFI sys crates and stay gated.
}

// Additional subdirectories present under src/runtime/ but not yet wired:
// dns_jsc, test_runner, timer, valkey_jsc, webview.
// These remain un-declared (blocked on bun_jsc method surface).


