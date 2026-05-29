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
    improper_ctypes,
    improper_ctypes_definitions,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    // Closure form `|t, g, c| T::method(t, g, c)` (not bare `T::method`) is
    // emitted intentionally so `&mut T → &T` autoref/coercion applies — some
    // impls take `&self`, others `&mut self`. clippy can't see the coercion.
    clippy::redundant_closure,
    // Generated thunks for `()`-returning methods emit `... -> ()`.
    clippy::unused_unit
)]

use crate::webcore::blob::BlobExt;
use crate::webcore::body::BodyMixin;

include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_classes.rs"));
