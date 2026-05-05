#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge for `bun.bundler`. Keeps `src/bundler/` free of JSC types.
//
// B-2 un-gate: `bun_jsc` is now a dependency (compiles with an opaque stub
// surface). Module files are wired in directly; functions whose bodies need
// methods that the `bun_jsc` stub surface does not yet expose are individually
// re-gated with `// TODO(b2-blocked): bun_X::Y` markers and reported upstream.

// ──────────────────────────────────────────────────────────────────────────
// Local bridge types
//
// `bun_jsc` does not currently `cargo check` (its own B-2 un-gating is in
// flight) and is dropped from Cargo.toml. Define crate-local opaque stand-ins
// for the handful of JSC types our signatures name so this crate type-checks
// independently. All function bodies that would *call* into JSC are gated and
// the missing symbols reported via `blocked_on`. Swap these `pub use` lines to
// `pub use bun_jsc::…` once that crate is green.
//
// TODO(b2-blocked): bun_jsc::JSGlobalObject
// TODO(b2-blocked): bun_jsc::JSValue
// TODO(b2-blocked): bun_jsc::VM
// TODO(b2-blocked): bun_jsc::ErrorableString
// TODO(b2-blocked): bun_jsc::JsResult
// TODO(b2-blocked): bun_jsc::JsError
// ──────────────────────────────────────────────────────────────────────────
mod jsc_stub {
    /// Opaque stand-in for `bun_jsc::JSGlobalObject` (C++ `JSC::JSGlobalObject`).
    #[repr(C)]
    pub struct JSGlobalObject {
        _p: [u8; 0],
        _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
    }
    /// Opaque stand-in for `bun_jsc::VM` (C++ `JSC::VM`).
    #[repr(C)]
    pub struct VM {
        _p: [u8; 0],
        _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
    }
    /// Opaque stand-in for `bun_jsc::JSValue` (encoded `JSC::JSValue`, pointer-width).
    #[repr(transparent)]
    #[derive(Debug, Clone, Copy, Default)]
    pub struct JSValue(pub usize);
    /// Opaque stand-in for `bun_jsc::ErrorableString`.
    #[derive(Debug, Default)]
    pub struct ErrorableString(core::marker::PhantomData<bun_string::String>);
}
pub use jsc_stub::{ErrorableString, JSGlobalObject, JSValue, VM};
pub type JsError = JSValue;
pub type JsResult<T> = Result<T, JsError>;

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
