#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! JSC bridge for `bun.bundler`. Keeps `src/bundler/` free of JSC types.

// ──────────────────────────────────────────────────────────────────────────
// Bridge types — re-exported from `bun_jsc` now that it `cargo check`s.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_jsc::{ErrorableString, JSGlobalObject, JSValue, JsError, JsResult, VM};

#[path = "source_map_mode_jsc.rs"]
pub mod source_map_mode_jsc;

#[path = "options_jsc.rs"]
pub mod options_jsc;

#[path = "PluginRunner.rs"]
pub mod PluginRunner;

#[path = "analyze_jsc.rs"]
pub mod analyze_jsc;
