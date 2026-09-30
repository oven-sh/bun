use crate::hir::environment_config::{EnvironmentConfig, ExternalFunctionConfig};

/// Bun-side options for the React Compiler pass.
///
/// This is the Bun port of upstream's `PluginOptions`
/// (`vendor/react-compiler/crates/react_compiler/src/entrypoint/plugin_options.rs`);
/// only the fields the Bun integration actually consumes are kept.
#[derive(Debug, Clone, Default)]
pub struct ReactCompilerOptions {
    pub enabled: bool,
    pub is_dev: bool,
    pub filename: Option<String>,
    /// `"infer"` / `"annotation"` / `"syntax"` / `"all"`. Defaults to `"infer"`.
    pub compilation_mode: Option<String>,
    /// `"none"` / `"critical_errors"` / `"all_errors"`. Defaults to `"none"`.
    pub panic_threshold: Option<String>,
    /// React target version (`"17"` / `"18"` / `"19"`). Defaults to `"19"`.
    pub target: Option<String>,
    pub environment: EnvironmentConfig,

    // ---- PluginOptions fields not yet consumed by the pipeline ----
    // These exist so a future `--react-compiler-config=<json>` CLI flag (and
    // the fixture runner's pragma parser) have a place to deserialize into.
    // Upstream reference: babel-plugin-react-compiler/src/Entrypoint/Options.ts
    /// Static gating import (wraps every compiled function in a feature-flag check).
    pub gating: Option<ExternalFunctionConfig>,
    /// Dynamic gating: source module path for `@dynamicGating({"source":"..."})`.
    pub dynamic_gating: Option<String>,
    /// `"client"` (default), `"ssr"`, or `"lint"`.
    pub output_mode: Option<String>,
    /// Test-only: read leading `// @key value` pragmas from the source and
    /// apply them to `self` before compiling. Set by the fixture runner.
    pub parse_test_pragmas: bool,
    /// Ignore `"use no forget"` / `"use no memo"` directives.
    pub ignore_use_no_forget: bool,
    /// Test-only: emit logger events into the output.
    pub logger_test_only: bool,
    /// Test-only: assert that nothing was compiled.
    pub expect_nothing_compiled: bool,
}
