//! Generated safe wrappers for C++ functions annotated `[[ZIG_EXPORT(mode)]]`.
//!
//! `src/codegen/cppbind.ts` parses every `.cpp` under `src/` for the
//! `[[ZIG_EXPORT(nothrow|zero_is_throw|false_is_throw|null_is_throw|check_slow)]]`
//! attribute and emits two siblings into `${BUN_CODEGEN_DIR}`:
//!
//!   - `cpp.zig`  — the Zig `bun.cpp.*` namespace (typed wrappers + raw externs)
//!   - `cpp.rs`   — this module's body
//!
//! Each throwing function gets a `pub fn` that opens a
//! [`TopExceptionScope`](crate::TopExceptionScope) /
//! [`ExceptionValidationScope`](crate::ExceptionValidationScope) **before** the FFI call
//! (so the C++ ThrowScope dtor's `simulateThrow()` is satisfied by the Rust-side scope's
//! `exception()` query under `BUN_JSC_validateExceptionChecks=1`), asserts the
//! return-sentinel/exception-state biconditional, and converts to
//! [`JsResult`](crate::JsResult). `nothrow` functions are re-exported as raw `extern "C"`.
//!
//! Generated wrappers use raw-pointer parameter types verbatim from the C++ signature
//! (`*mut JSGlobalObject`, `*const u8`, …) so they compose with whatever Rust-side
//! newtype the caller has in hand; the per-type ergonomic shims live next to the
//! type (`JSValue::get`, `JSPromise::resolve`, …) and delegate here.
#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    unused_imports,
    unused_unsafe,
    unused_variables,
    dead_code,
    improper_ctypes,
    improper_ctypes_definitions,
    // The generated `raw::` block is the canonical extern surface. A handful of
    // legacy hand-written decls (reference-typed params, `safe fn`) still exist
    // elsewhere in `bun_jsc` and are compiled before this module, so the lint
    // would fire here even though both spellings are ABI-identical (`&T` ≡
    // non-null `*const T`). New code must call `crate::cpp::*`, not redeclare.
    clashing_extern_declarations,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    clippy::too_many_arguments,
    clippy::all
)]

use crate::{JSGlobalObject, JSValue, JsError, JsResult};
// Generated `cpp.rs` may spell the string types as `bun_core::…` or
// `bun_core::…` depending on which side of the `bun_string → bun_core` merge
// the codegen ran on; alias here so both resolve.
#[allow(unused_imports)]
use bun_core as bun_string;

include!(concat!(env!("BUN_CODEGEN_DIR"), "/cpp.rs"));
