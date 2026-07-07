//! Hook for the codegen-emitted JS2Native Rust thunks.
//!
//! `src/codegen/generate-js2native.ts::getJS2NativeRust()` (driven by
//! `bundle-modules.ts`) writes `${BUN_CODEGEN_DIR}/generated_js2native.rs`;
//! this module `include!`s it so the `#[unsafe(no_mangle)] extern "C"`
//! `JS2Rust__*` symbols land in `bun_runtime` and satisfy the externs declared
//! by `GeneratedJS2Native.h` (the JS-module → native dispatch table).
//!
//! Each thunk calls the Rust function directly; a missing function is a
//! compile error in `cargo check -p bun_runtime`.
#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    // Closure form is intentional for `&mut T → &T` autoref/coercion.
    clippy::redundant_closure,
    clippy::unused_unit
)]

include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_js2native.rs"));
