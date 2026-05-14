//! Hook for the codegen-emitted per-sink Rust thunks.
//!
//! `src/codegen/generate-jssink.ts::rustSink()` writes
//! `${BUN_CODEGEN_DIR}/generated_jssink.rs`; this module `include!`s it so
//! the `#[unsafe(no_mangle)] extern "C"` symbols land in `bun_runtime` and
//! satisfy the `BUN_DECLARE_HOST_FUNCTION(${name}__{construct,write,end,
//! flush,start})` / `${name}__{getInternalFd,memoryCost}` externs declared
//! by `JSSink.cpp` / `headers.h`.
#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    unused_variables,
    unused_imports,
    dead_code,
    clippy::not_unsafe_ptr_arg_deref,
    clippy::all
)]

include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_jssink.rs"));
