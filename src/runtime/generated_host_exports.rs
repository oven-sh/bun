//! Hook for the codegen-emitted hand-written-export thunks.
//!
//! `src/codegen/generate-host-exports.ts` scrapes every
//! `// HOST_EXPORT(SymbolName)` marker under `src/runtime/` and `src/jsc/`,
//! classifies the safe-signature impl that follows, and writes
//! `${BUN_CODEGEN_DIR}/generated_host_exports.rs`; this module `include!`s it
//! so all `#[unsafe(no_mangle)] extern "C"` symbols land in one translation
//! unit inside `bun_runtime`. The
//! generated thunks call back into `crate::…` / `bun_jsc::…` paths via
//! `host_fn::*`, so a missing impl is a hard compile error here, not a runtime
//! `unimplemented!()`.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals, // Thunks pass `*mut <RustStruct>` where C++ stores it as `void*` and never
    // derefs, so its field layout is not part of the ABI.
    improper_ctypes, improper_ctypes_definitions, clippy::missing_safety_doc, clippy::not_unsafe_ptr_arg_deref,
    clippy::redundant_closure, clippy::unused_unit)]

include!(concat!(
    env!("BUN_CODEGEN_DIR"),
    "/generated_host_exports.rs"
));
