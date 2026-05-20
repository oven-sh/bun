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
    // The `${T}__fromJS`/`${T}__create` externs traffic in `*mut <RustStruct>`
    // where the C++ side stores the value as `void* m_ctx` and never derefs it
    // (see ZigGeneratedClasses.h `offsetOfWrapped`). The Rust payload's field
    // layout is therefore irrelevant to the ABI, but rustc's improper_ctypes
    // lint recurses into every field. Suppress here rather than forcing every
    // `m_ctx` payload (and its transitive fields — `JsRef`, `Strong`, …) to be
    // `#[repr(C)]` just to placate a lint about a pointer C++ treats as opaque.
    improper_ctypes,
    improper_ctypes_definitions,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    clippy::all
)]

// Bring BodyMixin into scope so codegen UFCS calls like
// `Request::get_text(&mut *this, …)` / `Response::get_blob(…)` resolve to the
// trait default methods (Zig: `BodyMixin(@This())` comptime mixin).
// NOTE: must be a named import — `as _` only covers `.method()` dot-call
// resolution, not the `Type::method(…)` qualified-path form the codegen emits.
use crate::webcore::body::BodyMixin;
// Same for `Blob`: the struct lives in `bun_jsc::webcore_types` (lower crate,
// data-only) but every JS-facing method (`get_text`, `get_slice`, …) is
// layered on via the `BlobExt` extension trait in `bun_runtime`. The codegen
// emits `Blob::get_text(&mut *this, …)` UFCS, so the trait must be in scope
// by name here for those calls to resolve.
use crate::webcore::blob::BlobExt;

include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_classes.rs"));
