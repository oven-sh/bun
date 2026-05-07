//! Hook for the codegen-emitted per-class Rust thunks.
//!
//! `src/codegen/generate-classes.ts::generateRust()` writes
//! `${BUN_CODEGEN_DIR}/generated_classes.rs`; this module `include!`s it so
//! the `#[unsafe(no_mangle)] extern "C"` symbols land in `bun_runtime` and
//! satisfy the externs declared by `ZigGeneratedClasses.cpp`.
//!
//! See `docs/.rust-rewrite-verified-claims.md` §GC-08 / §GC-09 /
//! §codegen-contract for the symbol/ABI contract.
#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    unused_variables,
    unused_imports,
    unused_unsafe,
    dead_code,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    clippy::all
)]

// Bring BodyMixin into scope so codegen UFCS calls like
// `Request::get_text(&mut *this, …)` / `Response::get_blob(…)` resolve to the
// trait default methods (Zig: `BodyMixin(@This())` comptime mixin).
use crate::webcore::body::BodyMixin as _;

include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_classes.rs"));
