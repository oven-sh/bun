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

// LAYERING: `output_file_jsc`
// constructs `webcore::Blob`/`Store`, `api::BuildArtifact`, and
// `node::PathOrFileDescriptor`. Those types live in `bun_runtime`, which is
// not a dependency of this crate. The module has been moved to
// `bun_runtime::api::output_file_jsc`; nothing depends on
// `bun_bundler_jsc::output_file_jsc`, so no re-export is needed.

#[path = "analyze_jsc.rs"]
pub(crate) mod analyze_jsc;

// ──────────────────────────────────────────────────────────────────────────
// `JSBundleCompletionTask` was MOVED to `bun_runtime::api::js_bundle_completion_task`
// (layering: its fields name `bun_runtime` types — `JSBundler::Config`,
// `Plugin`, `HTMLBundle::Route` — so a lower-tier crate cannot own it without
// a cycle). The earlier draft that imported `bun_runtime` from here has been
// dissolved; `bun_runtime` now depends on this crate for the JSC-aware option
// parsers in `options_jsc` only.
// ──────────────────────────────────────────────────────────────────────────
