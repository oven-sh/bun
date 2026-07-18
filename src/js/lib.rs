//! `bun_js` — unified JavaScript parser + printer crate.
//!
//! `#[path]`-mounts `src/js_parser/lib.rs` and `src/js_printer/lib.rs` so both
//! compile as submodules of this crate. Mount-point names match the absorbed
//! crate names so downstream collision rewrites are unambiguous.

#![feature(adt_const_params, generic_const_exprs)]
#![allow(incomplete_features)]
#![warn(unused_must_use)]
#![allow(ambiguous_glob_reexports, hidden_glob_reexports)]

extern crate self as bun_js;
pub extern crate self as bun_js_parser;
pub extern crate self as bun_js_printer;

#[path = "../js_parser/lib.rs"]
pub mod js_parser;
#[path = "../js_printer/lib.rs"]
pub mod js_printer;

pub use js_parser::*;
pub use js_printer::*;

/// Set from `bun_runtime::register_dispatch_tables()` with the VM-aware impl
/// body (`crate::vm::collect_macro_vm_garbage`). Free-fn hook (not a
/// [`js_parser::Macro::MacroRunner`] trait method) because it has no receiver
/// and its sole caller runs after both per-worker `MacroContext` boxes are
/// freed.
pub static MACRO_GC_HOOK: std::sync::OnceLock<fn()> = std::sync::OnceLock::new();

/// Sweep this thread's bundler-macro VM. See [`MACRO_GC_HOOK`].
#[inline]
pub fn collect_vm_garbage() {
    if let Some(f) = MACRO_GC_HOOK.get() {
        f()
    }
}
