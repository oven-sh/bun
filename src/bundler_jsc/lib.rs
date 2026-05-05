#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
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

#[path = "output_file_jsc.rs"]
pub mod output_file_jsc;

#[path = "analyze_jsc.rs"]
pub mod analyze_jsc;

// ──────────────────────────────────────────────────────────────────────────
// JSBundleCompletionTask remains module-gated: its Phase-A body depends
// pervasively on higher-tier `bun_runtime::api::*` (HTMLBundleRoute,
// JSBundlerConfig, BuildArtifact, NodeFS), `bun_standalone`, `bun_dot_env`,
// `bun_schema`, plus dozens of `bun_jsc::JSPromise`/`VirtualMachine`/`Strong`
// methods absent from the stub surface. Re-gating "just the fn body" would
// gate every fn in the 888-line file; the module gate is equivalent and keeps
// the draft addressable on disk.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(any())]
#[path = "JSBundleCompletionTask.rs"]
pub mod JSBundleCompletionTask_draft;
pub mod JSBundleCompletionTask {
    // TODO(b2-blocked): bun_jsc::JSPromise::Strong
    // TODO(b2-blocked): bun_jsc::AnyTask / ConcurrentTask / EventLoop (methods)
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::bun_vm
    // TODO(b2-blocked): bun_bundler::bundle_v2::BundleV2
    // TODO(b2-blocked): bun_bundler::bundle_v2::BundleThread
    // TODO(b2-blocked): bun_ptr::IntrusiveArc
    // TODO(b2-blocked): bun_aio::KeepAlive
    // (higher-tier — cannot depend): bun_runtime::api::{js_bundler, html_bundle, BuildArtifact}, bun_runtime::node::fs
    pub struct JSBundleCompletionTask(());
}
