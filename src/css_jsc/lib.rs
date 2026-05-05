#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all three Phase-A draft modules are gated behind
// `#[cfg(any())]` because they depend on:
//   - `bun_jsc` / `bun_str` crates (not yet linked in Cargo.toml)
//   - missing surface from `bun_css` (Browsers, Targets, StyleSheet, CssColor, ...)
//   - unstable `adt_const_params` (ConstParamTy derive on enums used as const generics)
// Un-gating happens in B-2 once lower-tier stub surfaces land.

#[cfg(any())]
pub mod error_jsc;
#[cfg(any())]
pub mod css_internals;
#[cfg(any())]
pub mod color_js;

// ---- minimal stub surface ----------------------------------------------------
// TODO(b1): bun_jsc::{JSGlobalObject, JSValue, CallFrame, JsResult} missing
// TODO(b1): bun_str::String / StringJsc missing
// TODO(b1): bun_css::{StyleSheet, StyleAttribute, CssColor, ParserOptions, ...} missing

/// Stub for `color_js::js_function_color`. Real impl gated above.
pub fn js_function_color(_global: *mut (), _call_frame: *mut ()) -> ! {
    todo!("bun_css_jsc::js_function_color (gated in B-1)")
}

/// Stub for `css_internals::test_*` host fns. Real impl gated above.
pub mod css_internals {
    #[derive(PartialEq, Eq, Clone, Copy)]
    pub enum TestKind {
        Normal,
        Minify,
        Prefix,
    }
    #[derive(PartialEq, Eq, Clone, Copy)]
    pub enum TestCategory {
        Normal,
        ParserOptions,
    }
}
