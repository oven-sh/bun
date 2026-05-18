//! Hook for the codegen-emitted hand-written-export thunks.
//!
//! `src/codegen/generate-host-exports.ts` scrapes every
//! `// HOST_EXPORT(SymbolName)` marker under `src/runtime/` and `src/jsc/`,
//! classifies the safe-signature impl that follows, and writes
//! `${BUN_CODEGEN_DIR}/generated_host_exports.rs`; this module `include!`s it
//! so all `#[unsafe(no_mangle)] extern "C"` symbols land in one translation
//! unit inside `bun_runtime`. Mirrors `generated_classes.rs` exactly — the
//! generated thunks call back into `crate::…` / `bun_jsc::…` paths via
//! `host_fn::*`, so a missing impl is a hard compile error here, not a runtime
//! `unimplemented!()`.
//!
//! Why a code generator instead of the `#[bun_jsc::host_fn(export = "…")]`
//! proc-macro: the proc-macro emits the `#[no_mangle]` shim *inline* next to
//! every impl, scattering ~425 unmangled symbols across 80+ files. Centralising
//! them here means (a) one place to audit the C-ABI surface, (b) the source
//! files contain zero raw-pointer-deref boilerplate, (c) win-x64
//! `extern "sysv64"` cfg-splitting is done once instead of duplicated per
//! macro expansion.
#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    unused_variables,
    unused_imports,
    unused_unsafe,
    dead_code,
    // Thunks pass `*mut <RustStruct>` where C++ stores it as `void*` and never
    // derefs — same rationale as `generated_classes.rs`.
    improper_ctypes,
    improper_ctypes_definitions,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    clippy::all
)]

// Generated `generated_host_exports.rs` may spell `bun_core::String` or
// `bun_core::String` depending on which side of the merge the codegen ran on;
// alias here so both resolve.
#[allow(unused_imports)]
use bun_core as bun_string;

include!(concat!(
    env!("BUN_CODEGEN_DIR"),
    "/generated_host_exports.rs"
));
