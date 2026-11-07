#![warn(unused_must_use)]
//! `bun_css_jsc` — JSC bridge for `bun_css`.

pub(crate) mod color_js;
pub(crate) mod css_internals;
pub(crate) mod generated_bindgen;

pub(crate) use bun_jsc::JsResult;
