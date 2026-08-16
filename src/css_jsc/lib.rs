#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! `bun_css_jsc` — JSC bridge for `bun_css`.

pub mod color_js;
pub mod css_internals;
pub(crate) mod error_jsc;

pub use color_js::js_function_color;

pub(crate) use bun_jsc::JsResult;
