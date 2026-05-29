//! Runtime plugin host (JS-side `Bun.plugin()` resolve hooks). Moved from
//! `bundler/transpiler.zig` so `bundler/` is free of `JSValue`/`JSGlobalObject`.

pub use bun_resolver::fs::Path as FsPath;

/// Spec `PluginRunner.zig:MacroJSCtx` — re-export of the canonical newtype
/// (defined at the lowest tier that stores it, `bun_ast::Macro`).
pub use bun_bundler::transpiler::MacroJSCtx as MacroJsCtx;

pub use bun_jsc::plugin_runner::PluginRunner;

/// Spec PluginRunner.zig:14 — re-export for callers that named this module.
#[inline]
pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
    PluginRunner::extract_namespace(specifier)
}

/// Spec PluginRunner.zig:22 — re-export for callers that named this module.
#[inline]
pub fn could_be_plugin(specifier: &[u8]) -> bool {
    PluginRunner::could_be_plugin(specifier)
}

pub use bun_jsc::virtual_machine::plugin_runner_on_resolve_jsc as on_resolve_jsc;

// ported from: src/bundler_jsc/PluginRunner.zig
