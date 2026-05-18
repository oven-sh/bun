//! Hook for the codegen-emitted JS2Native Rust thunks.
//!
//! `src/codegen/generate-js2native.ts::getJS2NativeRust()` (driven by
//! `bundle-modules.ts`) writes `${BUN_CODEGEN_DIR}/generated_js2native.rs`;
//! this module `include!`s it so the `#[unsafe(no_mangle)] extern "C"`
//! `JS2Zig__*` symbols land in `bun_runtime` and satisfy the externs declared
//! by `GeneratedJS2Native.h` (the JS-module → native dispatch table).
//!
//! Mirrors `generated_classes.rs` exactly: thunks dispatch through a
//! `Js2NativeImpl` trait whose default method bodies panic with a "not yet
//! ported" message; porting a `$zig()` call site means overriding the
//! matching method on `Js2Native`.
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

include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_js2native.rs"));
