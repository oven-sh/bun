#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
// FFI signatures with non-repr(C) types are silent ABI corruption — promote to
// hard errors. Opaque-pointer round-trips (C++ stores `void*`, never derefs)
// are individually `#[allow]`ed at the extern block with a justification.
#![deny(improper_ctypes, improper_ctypes_definitions)]
#![feature(adt_const_params)]

pub mod error;
pub use error::{Error, Result};

/// `crate::jsc` is now a thin re-export of the real `bun_jsc` crate. Draft
/// modules that imported `crate::jsc::…` (instead of `bun_jsc::…`) continue to
/// resolve unchanged.
pub mod jsc {
    pub use bun_jsc::*;
}

// ─── runtime submodules ──────────────────────────────────────────────────
pub mod allocators; // moved from bun_alloc (tier-0 → bun_core/sys/runtime back-edge)
pub mod crypto;
pub mod ffi;
#[path = "node.rs"]
pub mod node;
pub mod server;
pub mod socket;
#[path = "webcore.rs"]
pub mod webcore;

pub mod bake;
pub mod cli;
pub mod shell;
// `Run::boot` / `Run::boot_standalone`. Mounted here
// (not as a separate crate) because every dependency it has is already a dep of
// `bun_runtime`, and the CLI dispatch in `cli/` needs to call it directly. The
// original "higher-tier crate" split was speculative; folding it in breaks the
// cycle the `bun_bun_js` shims were papering over.
#[path = "api.rs"]
pub mod api;
pub mod dispatch;
pub mod hw_exports;
pub mod ipc_host;
pub mod jsc_hooks;
pub mod linear_fifo_testing;
pub mod napi;
pub mod pe_testing;
#[path = "../bun.js.rs"]
pub mod run_main;
pub mod timer;
// `generated_classes_list.rs` lives under `src/jsc/` but every type it
// aliases is defined in this crate (api/webcore/test_runner/bake) or a
// same-tier dep, so it is `#[path]`-mounted here to avoid a bun_jsc cycle.
#[path = "../jsc/generated_classes_list.rs"]
pub mod generated_classes_list;
pub use generated_classes_list::Classes as GeneratedClassesList;
pub mod generated_classes; // include!()s ${BUN_CODEGEN_DIR}/generated_classes.rs
pub mod generated_host_exports; // include!()s ${BUN_CODEGEN_DIR}/generated_host_exports.rs
pub mod generated_js2native; // include!()s ${BUN_CODEGEN_DIR}/generated_js2native.rs
pub mod generated_jssink; // include!()s ${BUN_CODEGEN_DIR}/generated_jssink.rs

pub mod dns_jsc;
pub mod image;
pub mod test_runner;
pub mod valkey_jsc;

// ─── crate-root re-exports for `cli/` submodules ────────────────────────────
// Modules under `src/runtime/cli/**` use crate-root paths
// (`crate::Command`, `crate::test_command`, `crate::run_command`, …).
// Surface those names here
// so `*_command.rs` and `test/parallel/*.rs` files resolve their
// `use crate::…` lines without per-file edits.
pub use cli::{
    Cli, Command, add_completions, build_command, bunx_command, command, create_command,
    filter_arg, filter_run, multi_run, package_manager_command, run_command, shell_completions,
    test_command,
};

pub mod webview;
