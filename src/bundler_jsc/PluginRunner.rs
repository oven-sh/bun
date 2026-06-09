//! Runtime plugin host (JS-side `Bun.plugin()` resolve hooks). Lives here so
//! `bundler/` is free of `JSValue`/`JSGlobalObject`.

pub use bun_resolver::fs::Path as FsPath;

/// Re-export of the canonical newtype
/// (defined at the lowest tier that stores it, `bun_ast::Macro`).
pub use bun_bundler::transpiler::MacroJSCtx as MacroJsCtx;

/// Re-export of the concrete struct.
/// `extract_namespace` / `could_be_plugin` (pure byte parsing) live in
/// `bun_bundler`; the stateful struct + `on_resolve` body live in
/// `bun_jsc::plugin_runner`. `on_resolve_jsc` (below) is a free fn because it
/// only reads the global, not the runner record.
pub use bun_jsc::plugin_runner::PluginRunner;

/// Re-export for callers that named this module.
#[inline]
pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
    PluginRunner::extract_namespace(specifier)
}

/// Re-export for callers that named this module.
#[inline]
pub fn could_be_plugin(specifier: &[u8]) -> bool {
    PluginRunner::could_be_plugin(specifier)
}

// `on_resolve` (the `Log`-reporting variant) lives at
// `bun_jsc::plugin_runner::PluginRunner` as the `PluginResolver` impl —
// `bun_jsc` is the lowest tier that can name `JSGlobalObject` AND is reachable
// from `Bun__onDidAppendPlugin`.

/// LAYERING: body moved DOWN into `bun_jsc::virtual_machine` so the
/// VM's `resolve_maybe_needs_trailing_slash` can consult it without a
/// `bun_jsc → bun_bundler_jsc` cycle. Re-exported here for callers that
/// still name this module.
pub use bun_jsc::virtual_machine::plugin_runner_on_resolve_jsc as on_resolve_jsc;
