#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: every module here references `bun_jsc` (JSGlobalObject /
// JSValue / JsResult / webcore::Blob / api::BuildArtifact …) which is a
// higher-tier crate not in this crate's dependency list. Phase-A draft bodies
// are preserved on disk behind `#[cfg(any())]`; minimal stub surfaces are
// exposed so dependents resolve. Un-gating happens in B-2 once the JSC bridge
// crate is available.

#[cfg(any())]
#[path = "source_map_mode_jsc.rs"]
pub mod source_map_mode_jsc_draft;
pub mod source_map_mode_jsc {
    // TODO(b1): needs bun_jsc::{JSGlobalObject, JSValue, JsResult}
    pub fn source_map_mode_from_js() -> ! { todo!("b1-stub: source_map_mode_from_js") }
}

#[cfg(any())]
#[path = "options_jsc.rs"]
pub mod options_jsc_draft;
pub mod options_jsc {
    // TODO(b1): needs bun_jsc + bun_str::ZigString
    pub fn target_from_js() -> ! { todo!("b1-stub: target_from_js") }
    pub fn format_from_js() -> ! { todo!("b1-stub: format_from_js") }
    pub fn loader_from_js() -> ! { todo!("b1-stub: loader_from_js") }
    pub fn compile_target_from_js() -> ! { todo!("b1-stub: compile_target_from_js") }
}

#[cfg(any())]
#[path = "analyze_jsc.rs"]
pub mod analyze_jsc_draft;
pub mod analyze_jsc {
    // TODO(b1): needs bun_jsc::{JSGlobalObject, VM} + bun_runtime::test_runner
    //           + bun_bundler::analyze_transpiled_module (gated upstream)
}

#[cfg(any())]
#[path = "output_file_jsc.rs"]
pub mod output_file_jsc_draft;
pub mod output_file_jsc {
    // TODO(b1): needs bun_jsc::{api::BuildArtifact, webcore::Blob, node::PathLike}
    //           + bun_bundler::output_file (gated upstream)
}

#[cfg(any())]
#[path = "PluginRunner.rs"]
pub mod PluginRunner_draft;
pub mod PluginRunner {
    // TODO(b1): needs bun_jsc::{ErrorableString, JSGlobalObject, JSValue, BunPluginTarget}
    //           + bun_str + bun_fs::Path
    pub type MacroJsCtx = (); // opaque stub — was JSValue
    pub struct PluginRunner<'a>(core::marker::PhantomData<&'a ()>);
}

#[cfg(any())]
#[path = "JSBundleCompletionTask.rs"]
pub mod JSBundleCompletionTask_draft;
pub mod JSBundleCompletionTask {
    // TODO(b1): needs bun_jsc (JSPromise, JSGlobalObject, VirtualMachine, …)
    pub struct JSBundleCompletionTask(());
}
