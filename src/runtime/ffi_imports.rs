//! Consolidated `unsafe extern "C" { … }` import surface for `bun_runtime`.
//!
//! Phase-f goal: one `extern "C"` block per crate instead of the ~308
//! scattered across `src/runtime/**/*.rs` (each with its own
//! `#[allow(improper_ctypes)]` and a slightly different spelling of the same
//! C++ symbol). The generator at `src/codegen/generate-host-exports.ts` emits
//! a per-file tally as a trailing comment in `generated_host_exports.rs`; this
//! module is the *destination* for that migration. Moving an extern block here:
//!
//!   1. cut the `unsafe extern "C" { fn Foo(...); }` decl from its current file,
//!   2. paste the `fn Foo(...)` line into the matching subsystem block below
//!      (add a new block if none fits),
//!   3. add `pub(crate)` so the original module can `use crate::ffi_imports::Foo;`,
//!   4. re-run `cargo check -p bun_runtime`.
//!
//! Do NOT move `extern "Rust" { … }` cycle-breaking hooks here — those are
//! intentionally co-located with the vtable they fill (see `dispatch.rs` /
//! `jsc_hooks.rs`). Do NOT move the codegen-emitted `js_${T}` extern blocks
//! from `generated_classes.rs` — those are owned by the generator.
#![allow(non_snake_case, dead_code, improper_ctypes, clippy::missing_safety_doc)]

use bun_core::String as BunString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue};
use core::ffi::{c_char, c_int, c_void};

// ─── ZigGlobalObject.cpp / BunObject.cpp ────────────────────────────────────
// (populated incrementally — see audit comment in generated_host_exports.rs)
// Empty until the first migration lands; an empty `unsafe extern "C" {}` block
// and `use crate::ffi_imports::*` over zero items are both legal Rust.
unsafe extern "C" {}
