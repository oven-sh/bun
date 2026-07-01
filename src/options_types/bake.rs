//! Bake `Framework` vocabulary types.
//!
//! TYPE_ONLY: pure value types shared by the bundler, parser, and runtime.
//! `bun_bundler::bake_types` re-exports them so existing spellings keep
//! resolving.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClientCssInJs {
    #[default]
    AutoOnImportCss,
    Facade,
    FacadeOnImportCss,
}

/// TYPE_ONLY subset of the `Framework` fields
/// the bundler/parser actually consult; `file_system_router_types`
/// stays in T6 because only `bake::FrameworkRouter` reads it.
#[non_exhaustive]
pub struct Framework {
    pub built_in_modules: bun_collections::StringArrayHashMap<crate::bundle_enums::BuiltInModule>,
    /// Mirrors `Framework.server_components`.
    pub server_components: Option<ServerComponents>,
    /// Mirrors `Framework.react_fast_refresh` — read by the parser
    /// (`js_parser/ast/Parser.rs:1997` resolves `framework.react_fast_refresh
    /// .import_source`) when `features.react_fast_refresh` is on.
    pub react_fast_refresh: Option<ReactFastRefresh>,
    /// Mirrors `Framework.is_built_in_react` — read by
    /// `linker_context::generateChunksInParallel` to gate `BakeExtra`.
    pub is_built_in_react: bool,
    /// Read by `entry_points.rs` (FallbackEntryPoint/ClientEntryPoint::generate).
    pub client_css_in_js: ClientCssInJs,
}
impl Framework {
    /// Construct the bundler-side TYPE_ONLY view. Called from
    /// `bun_runtime::bake::Framework::init_transpiler_with_options`; the
    /// runtime owns the canonical `bake.Framework` and projects the
    /// fields the bundler reads.
    pub fn new(
        built_in_modules: bun_collections::StringArrayHashMap<crate::bundle_enums::BuiltInModule>,
        server_components: Option<ServerComponents>,
        react_fast_refresh: Option<ReactFastRefresh>,
        is_built_in_react: bool,
    ) -> Self {
        Self {
            built_in_modules,
            server_components,
            react_fast_refresh,
            is_built_in_react,
            client_css_in_js: ClientCssInJs::default(),
        }
    }
}
impl Default for Framework {
    fn default() -> Self {
        Framework::new(
            bun_collections::StringArrayHashMap::new(),
            None,
            None,
            false,
        )
    }
}
impl Framework {
    /// Deep clone; the built-in-module map clone is fallible (OOM routes
    /// through handle_oom like every other map clone).
    pub fn deep_clone(&self) -> Framework {
        Framework::new(
            bun_core::handle_oom(self.built_in_modules.clone()),
            self.server_components.clone(),
            self.react_fast_refresh.clone(),
            self.is_built_in_react,
        )
    }
}
/// `Framework.ServerComponents` — full string
/// surface so the parser-side projection (ParseTask.rs `run_with_source_code`)
/// can forward user-configured `serverRegisterServerReference` /
/// `clientRegisterServerReference` instead of hardcoding defaults.
#[derive(Clone)]
pub struct ServerComponents {
    pub separate_ssr_graph: bool,
    pub server_runtime_import: Box<[u8]>,
    pub server_register_client_reference: Box<[u8]>,
    pub server_register_server_reference: Box<[u8]>,
    pub client_register_server_reference: Box<[u8]>,
}
impl Default for ServerComponents {
    fn default() -> Self {
        Self {
            separate_ssr_graph: false,
            server_runtime_import: Box::default(),
            server_register_client_reference: Box::from(&b"registerClientReference"[..]),
            server_register_server_reference: Box::from(&b"registerServerReference"[..]),
            client_register_server_reference: Box::from(&b"registerServerReference"[..]),
        }
    }
}
#[derive(Clone)]
pub struct ReactFastRefresh {
    pub import_source: Box<[u8]>,
}
impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self {
            import_source: Box::from(&b"react-refresh/runtime"[..]),
        }
    }
}
