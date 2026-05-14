//! `js2native` path-resolution marker.
//!
//! `src/codegen/generate-js2native.ts` derives both the `JS2Zig__` C-ABI
//! symbol prefix and the Rust dispatch path from the on-disk location of the
//! file named in a `$rust(...)` macro. The actual implementation moved to
//! src/runtime/shell/shell_body.rs (re-exported as crate::shell::shell in mod.rs) during the Rust port,
//! but the codegen-facing module path was kept stable so symbol names and
//! `crate::` paths in `generated_js2native.rs` stay unchanged.
//!
//! This file is never compiled (it isn't declared as a module anywhere); it
//! exists only so the codegen can resolve `$rust("shell.rs", …)`. Deleting
//! it will fail the build with a "Could not find file" error.
