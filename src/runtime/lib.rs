#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![feature(adt_const_params)]
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
pub mod allocators; // MOVED from bun_alloc (CYCLEBREAK: tier-0 → bun_core/sys/runtime back-edge)
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
pub mod jsc_hooks;
pub mod hw_exports;
pub mod generated_classes; // include!()s ${BUN_CODEGEN_DIR}/generated_classes.rs

// ─── un-gated in B-2 round 3 (each subdir owns a real `mod.rs`; heavy bodies
//     re-gated *inside* those files) ────────────────────────────────────────
// `image` was previously an inline stub re-declaring thumbhash/quantize/exif
// here; that's now the job of `src/runtime/image/mod.rs` (which also carries
// the gated codec_*/backend_* drafts). Dropping the inline stub means a single
// flip point per subtree.
pub mod image;
pub mod dns_jsc;
pub mod valkey_jsc;
pub mod test_runner;

// ─── crate-root re-exports for `cli/` submodules ────────────────────────────
// Phase-A drafts under `src/runtime/cli/**` were ported with crate-root paths
// (`crate::Command`, `crate::test_command`, `crate::run_command`, …) because
// the Zig source treats `cli.zig` as the binary root. Surface those names here
// so the un-gated `*_command.rs` and `test/parallel/*.rs` files resolve their
// `use crate::…` lines without per-file edits.
pub use cli::{
    command, Command, Cli,
    run_command, test_command, build_command, bunx_command, create_command,
    package_manager_command, filter_arg, filter_run, multi_run,
    shell_completions, add_completions,
};

// Additional subdirectories present under src/runtime/ but not yet wired:
// webview.
// These remain un-declared (blocked on bun_jsc method surface).


