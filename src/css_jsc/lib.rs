#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_css_jsc` — JSC bridge for `bun_css`. B-2 un-gated: module-level
//! `#[cfg(any())]` removed; fn bodies that depend on lower-tier surface still
//! missing (`bun_jsc` JSValue methods, `bun_css` parser/printer types,
//! `bun_string` JSC ext-trait) are individually re-gated with
//! `// TODO(b2-blocked):` markers. Type/enum/helper definitions compile real.

pub mod error_jsc;
pub mod css_internals;
pub mod color_js;

pub use color_js::js_function_color;

// Local until `bun_jsc::JsResult` lands (T0 stub surface lacks it).
// TODO(b2-blocked): bun_jsc::JsResult
pub(crate) type JsResult<T> = Result<T, bun_jsc::JSValue>;
