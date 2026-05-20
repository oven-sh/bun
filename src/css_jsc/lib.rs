#![feature(allocator_api)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! `bun_css_jsc` — JSC bridge for `bun_css`. All fn bodies
//! compile against the `bun_jsc` / `bun_css` surface. The two
//! `OutputColorFormat::{Hsl,Lab}` match-arm bodies in `color_js` remain
//! ``-gated on `bun_css::values::color::*::{into_hsl,into_lab}`
//! (the colorspace matrix tables in `values/color.rs` are still gated).

pub mod color_js;
pub mod css_internals;
pub mod error_jsc;

pub use color_js::js_function_color;

pub(crate) use bun_jsc::JsResult;
