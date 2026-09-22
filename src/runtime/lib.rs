#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
// FFI signatures with non-repr(C) types are silent ABI corruption — promote to
// hard errors. Opaque-pointer round-trips (C++ stores `void*`, never derefs)
// are individually `#[allow]`ed at the extern block with a justification.
#![deny(improper_ctypes, improper_ctypes_definitions)]
#![feature(thread_local)]
#![feature(adt_const_params)]
// For `__rust_no_alloc_shim_is_unstable_v2` in bin_entry.
#![feature(rustc_attrs)]
#![allow(internal_features)]
// The unit-test harness leaves out `bin_entry` (below), the root that keeps
// this crate's `pub(crate)` items alive, so in a test build most of the crate
// reads as dead code. `dead_code` is checked by the crate's own build.
#![cfg_attr(test, allow(dead_code))]

pub(crate) mod error;
pub(crate) use error::{Error, Result};

/// The process entry point (`main`) and the handful of C-ABI symbols that must
/// be direct link inputs of the final binary. This crate is built as the
/// staticlib the native build links against; the unit-test harness brings its
/// own `main` and allocator.
#[cfg(not(test))]
mod bin_entry;

/// `crate::jsc` is now a thin re-export of the real `bun_jsc` crate. Draft
/// modules that imported `crate::jsc::…` (instead of `bun_jsc::…`) continue to
/// resolve unchanged.
pub(crate) mod jsc {
    pub(crate) use bun_jsc::*;
}

// ─── runtime submodules ──────────────────────────────────────────────────
pub(crate) mod allocators; // moved from bun_alloc (tier-0 → bun_core/sys/runtime back-edge)
pub(crate) mod crypto;
pub(crate) mod ffi;
#[path = "node.rs"]
pub(crate) mod node;
pub(crate) mod server;
pub(crate) mod socket;
#[path = "webcore.rs"]
pub(crate) mod webcore;

pub(crate) mod bake;
pub(crate) mod cli;
pub(crate) mod shell;
// `Run::boot` / `Run::boot_standalone`. Mounted here
// (not as a separate crate) because every dependency it has is already a dep of
// `bun_runtime`, and the CLI dispatch in `cli/` needs to call it directly. The
// original "higher-tier crate" split was speculative; folding it in breaks the
// cycle the `bun_bun_js` shims were papering over.
#[path = "api.rs"]
pub(crate) mod api;
pub(crate) mod dispatch;
pub(crate) mod hw_exports;
pub(crate) mod ipc;
pub(crate) mod ipc_host;
pub(crate) mod jsc_hooks;
#[path = "JSONLineBuffer.rs"]
pub(crate) mod json_line_buffer;
pub(crate) mod linear_fifo_testing;
pub(crate) mod napi;
#[path = "../bun.js.rs"]
pub(crate) mod run_main;
pub(crate) mod timer;

pub(crate) mod generated_classes; // include!()s ${BUN_CODEGEN_DIR}/generated_classes.rs
pub(crate) mod generated_host_exports; // include!()s ${BUN_CODEGEN_DIR}/generated_host_exports.rs
pub(crate) mod generated_js2native; // include!()s ${BUN_CODEGEN_DIR}/generated_js2native.rs
pub(crate) mod generated_jssink; // include!()s ${BUN_CODEGEN_DIR}/generated_jssink.rs

pub(crate) mod dns_jsc;
pub(crate) mod image;
pub(crate) mod test_runner;
pub(crate) mod valkey_jsc;

// ─── crate-root re-exports for `cli/` submodules ────────────────────────────
// Modules under `src/runtime/cli/**` use crate-root paths
// (`crate::Command`, `crate::test_command`, `crate::run_command`, …).
// Surface those names here
// so `*_command.rs` and `test/parallel/*.rs` files resolve their
// `use crate::…` lines without per-file edits.
pub(crate) use cli::{
    Cli, Command, build_command, command, filter_arg, package_manager_command, run_command,
    shell_completions, test_command,
};

pub(crate) mod webgpu;
pub(crate) mod webview;
