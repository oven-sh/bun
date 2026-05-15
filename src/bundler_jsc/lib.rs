#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! JSC bridge for `bun.bundler`. Keeps `src/bundler/` free of JSC types.
//
// B-2 un-gate: `bun_jsc` is now a dependency (compiles with an opaque stub
// surface). Module files are wired in directly; functions whose bodies need
// methods that the `bun_jsc` stub surface does not yet expose are individually
// re-gated with `// TODO(b2-blocked): bun_X::Y` markers and reported upstream.

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

// LAYERING: `output_file_jsc` (port of `src/bundler_jsc/output_file_jsc.zig`)
// constructs `webcore::Blob`/`Store`, `api::BuildArtifact`, and
// `node::PathOrFileDescriptor`. Those types live in `bun_runtime`, which is
// not a dependency of this crate. The module has been moved to
// `bun_runtime::api::output_file_jsc`; nothing depends on
// `bun_bundler_jsc::output_file_jsc`, so no re-export is needed.

#[path = "analyze_jsc.rs"]
pub mod analyze_jsc;

// ──────────────────────────────────────────────────────────────────────────
// `JSBundleCompletionTask` was MOVED to `bun_runtime::api::js_bundle_completion_task`
// (layering: its fields name `bun_runtime` types — `JSBundler::Config`,
// `Plugin`, `HTMLBundle::Route` — so a lower-tier crate cannot own it without
// a cycle). The Phase-A draft that imported `bun_runtime` from here has been
// dissolved; `bun_runtime` now depends on this crate for the JSC-aware option
// parsers in `options_jsc` only.
// ──────────────────────────────────────────────────────────────────────────
