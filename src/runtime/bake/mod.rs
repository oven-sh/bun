//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
//!
//! This file holds the keystone DevServer struct + lifecycle so downstream
//! `server/` and the `bun_bundler::dispatch::DevServerVTable` can be wired.
//! The heavy method bodies (request handling, finalize_bundle, hot-update
//! tracing) live in `DevServer.rs` and the other `#[path]` submodules below.

use core::ptr::NonNull;
use std::borrow::Cow;

// ─── Submodule bodies ────────────────────────────────────────────────────────
// `bake_body.rs` carries the Framework/UserOptions/BuildConfigSubset `from_js`
// impls plus the `init_server_runtime`/`get_hmr_runtime` host fns.
#[path = "bake_body.rs"]
pub(crate) mod bake_body;

#[path = "DevServer.rs"]
mod dev_server_body;
pub(crate) use dev_server_body::get_deinit_count_for_testing;
pub(crate) use dev_server_body::is_allowed_dev_host;
pub(crate) use dev_server_body::is_allowed_host_header;

#[path = "FrameworkRouter.rs"]
pub(crate) mod framework_router_body;

#[path = "production.rs"]
mod production_body;

// `Bun__add{Bake,DevServer}SourceProvider*` host exports — the Rust side of
// `BakeSourceProvider.h` / `DevServerSourceProvider.h`. Reached only via the
// codegen-emitted `extern "C"` thunks in `generated_host_exports.rs`.
pub mod source_provider_exports;

// Re-exports from the submodule bodies so `production.rs` can name them
// without going through the keystone stubs below.
pub use bake_body::{PatternBuffer, UserOptions, print_warning};

/// All bake JSC references go through this re-export of `bun_jsc`.
pub mod jsc {
    /// `jsc.API.JSBundler.Plugin` — the C++ `BunPlugin` FFI handle. The
    /// canonical opaque struct lives in `bun_bundler::bundle_v2::api::JSBundler`
    /// (T5) and is re-exported through `crate::api::js_bundler` so the
    /// JSC-aware `PluginJscExt` methods are in scope; both paths name the same
    /// nominal type.
    pub(crate) use crate::api::js_bundler::Plugin;
    pub(crate) use crate::jsc::*;
}

// ══════════════════════════════════════════════════════════════════════════
// Top-level types
// ══════════════════════════════════════════════════════════════════════════

pub use bun_bundler::bake_types::BuiltInModule;
/// `bake.Side` / `bake.Graph` — these are TYPE_ONLY moved-down into
/// `bun_bundler::bake_types` (lower tier owns the canonical defs so the
/// bundler can name them without depending on `bun_runtime`). Re-export
/// here so intra-crate `bake::Side` paths resolve.
pub use bun_bundler::bake_types::{Graph, Side};

/// `bake.Mode` — canonical definition. `bake_body::Mode` re-exports this
/// (`pub use super::Mode;`) so both paths name the same nominal type.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mode {
    Development,
    ProductionDynamic,
    ProductionStatic,
}

/// `bake.Framework.ServerComponents`.
///
/// String fields are arena-backed at runtime but default to static literals.
/// `Cow<'static, [u8]>` covers both without leaking.
#[derive(Clone)]
pub struct ServerComponents {
    pub separate_ssr_graph: bool,
    /// REQUIRED — `fromJS` throws if `serverRuntimeImportSource` is absent.
    pub server_runtime_import: Cow<'static, [u8]>,
    pub server_register_client_reference: Cow<'static, [u8]>,
    pub server_register_server_reference: Cow<'static, [u8]>,
    pub client_register_server_reference: Cow<'static, [u8]>,
}
// No `Default` impl — `server_runtime_import` is a required field. Callers must
// supply it explicitly (`Framework::react()` sets `"react-server-dom-bun/server"`).

#[derive(Clone)]
pub struct ReactFastRefresh {
    pub import_source: Cow<'static, [u8]>,
}
impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self {
            import_source: Cow::Borrowed(b"react-refresh/runtime"),
        }
    }
}

/// `bake.Framework.FileSystemRouterType`. Full body (with `Style` enum and
/// `from_js`) lives in the gated `bake_body.rs` draft; only the field set
/// DevServer touches is named here.
// Deliberately not `Clone` — `framework_router::Style` is the
// body enum (carries `JavascriptDefined(jsc::Strong)`, not `Clone`).
pub struct FileSystemRouterType {
    pub root: Cow<'static, [u8]>,
    pub prefix: Cow<'static, [u8]>,
    pub entry_client: Option<Cow<'static, [u8]>>,
    /// REQUIRED — `fromJS` throws if missing; `Framework.resolve`
    /// dereferences unconditionally.
    pub entry_server: Cow<'static, [u8]>,
    pub ignore_underscores: bool,
    pub ignore_dirs: Vec<Cow<'static, [u8]>>,
    pub extensions: Vec<Cow<'static, [u8]>>,
    pub style: framework_router::Style,
    pub allow_layouts: bool,
}

/// A "Framework" is simply a set of bundler options that a framework author
/// would set in order to integrate with the application. Since many fields
/// have default values which may point to static memory, this structure is
/// always arena-allocated, usually owned by the arena in `UserOptions`.
pub struct Framework {
    pub is_built_in_react: bool,
    /// Owned `Vec` so `resolve()` can take `&mut` and rewrite entries in
    /// place; freed by `Vec::drop`.
    pub file_system_router_types: Vec<FileSystemRouterType>,
    pub server_components: Option<ServerComponents>,
    pub react_fast_refresh: Option<ReactFastRefresh>,
    pub built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
}
impl Default for Framework {
    fn default() -> Self {
        Self {
            is_built_in_react: false,
            file_system_router_types: Vec::new(),
            server_components: None,
            react_fast_refresh: None,
            built_in_modules: bun_collections::StringArrayHashMap::new(),
        }
    }
}

impl Framework {
    /// Project the runtime-side `bake::Framework` into the bundler crate's
    /// TYPE_ONLY view (`bun_bundler::bake_types::Framework`). The bundler is a
    /// lower-tier crate and cannot name `bun_runtime::bake::Framework`; this is
    /// the value `init_transpiler` arena-allocates and hands to
    /// `out.options.framework`.
    pub(crate) fn as_bundler_view(&self) -> bun_bundler::bake_types::Framework {
        use bun_bundler::bake_types as bt;
        let mut built_in_modules = bun_collections::StringArrayHashMap::new();
        for (k, v) in self.built_in_modules.iter() {
            let bv = match v {
                BuiltInModule::Import(p) => BuiltInModule::Import(p.clone()),
                BuiltInModule::Code(c) => BuiltInModule::Code(c.clone()),
            };
            bun_core::handle_oom(built_in_modules.put(k, bv));
        }
        let server_components = self
            .server_components
            .as_ref()
            .map(|sc| bt::ServerComponents {
                separate_ssr_graph: sc.separate_ssr_graph,
                server_runtime_import: sc.server_runtime_import.as_ref().into(),
                server_register_client_reference: sc
                    .server_register_client_reference
                    .as_ref()
                    .into(),
                server_register_server_reference: sc
                    .server_register_server_reference
                    .as_ref()
                    .into(),
                client_register_server_reference: sc
                    .client_register_server_reference
                    .as_ref()
                    .into(),
            });
        let react_fast_refresh = self
            .react_fast_refresh
            .as_ref()
            .map(|rfr| bt::ReactFastRefresh {
                import_source: rfr.import_source.as_ref().into(),
            });
        bt::Framework::new(
            built_in_modules,
            server_components,
            react_fast_refresh,
            self.is_built_in_react,
        )
    }

    /// Sets up a per-graph
    /// `Transpiler` in place. The full body lives in
    /// `bake_body::Framework::init_transpiler_with_options`; this keystone
    /// version operates on the keystone `BuildConfigSubset` (which omits
    /// `conditions`/`env`/`define`/`drop` until the schema types are
    /// const-constructible — those paths default).
    /// Returns the arena slot for the `bake_types::Framework` projection; caller must `drop_in_place` it.
    pub fn init_transpiler<'a>(
        &mut self,
        arena: &'a bun_alloc::Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
    ) -> crate::Result<*mut bun_bundler::bake_types::Framework> {
        use bun_options_types::schema as bun_schema;

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
        let _ast_scope = ast_memory_allocator.enter();

        let out: &mut bun_bundler::Transpiler = out.write(bun_bundler::Transpiler::init(
            arena,
            log,
            bun_schema::api::TransformOptions::default(),
            None,
        )?);

        out.options.target = match renderer {
            Graph::Client => bun_ast::Target::Browser,
            Graph::Server | Graph::Ssr => bun_ast::Target::Bun,
        };
        out.options.public_path = match renderer {
            Graph::Client => dev_server::CLIENT_PREFIX.as_bytes().into(),
            Graph::Server | Graph::Ssr => Box::default(),
        };
        out.options.entry_points = Box::default();
        out.options.log = log;
        out.options.output_format = match mode {
            Mode::Development => bun_bundler::options::Format::InternalBakeDev,
            Mode::ProductionDynamic | Mode::ProductionStatic => bun_bundler::options::Format::Esm,
        };
        out.options.out_extensions = bun_collections::StringHashMap::new();
        out.options.hot_module_reloading = mode == Mode::Development;
        out.options.code_splitting = mode != Mode::Development;
        out.options.output_dir = Box::default();

        out.options.react_fast_refresh = mode == Mode::Development
            && renderer == Graph::Client
            && self.react_fast_refresh.is_some();
        out.options.server_components = self.server_components.is_some();

        out.options.conditions = bun_bundler::options::ESMConditions::init(
            out.options.target.default_conditions(),
            out.options.target.is_server_side(),
            bundler_options.conditions.keys(),
        )?;
        if renderer == Graph::Server && self.server_components.is_some() {
            out.options.conditions.append_slice(&[b"react-server"])?;
        }
        if mode == Mode::Development {
            out.options.conditions.append_slice(&[b"development"])?;
        }
        if matches!(renderer, Graph::Server | Graph::Ssr) {
            out.options.conditions.append_slice(&[b"node"])?;
        }

        out.options.production = mode != Mode::Development;
        out.options.tree_shaking = mode != Mode::Development;
        // The three minify overrides always default to `mode != Development`
        // here regardless of `BuildConfigSubset`. User-supplied minify flags
        // are only honored by `init_transpiler_with_options` (bake_body).
        out.options.minify_syntax = mode != Mode::Development;
        out.options.minify_identifiers = mode != Mode::Development;
        out.options.minify_whitespace = mode != Mode::Development;
        out.options.css_chunking = true;
        // The bundler crate (lower tier) carries a TYPE_ONLY
        // projection (`bake_types::Framework`); construct it here and give it
        // arena lifetime so `BundleOptions<'a>` can borrow it for the bundle pass.
        let framework_view: *mut bun_bundler::bake_types::Framework =
            arena.alloc(self.as_bundler_view());
        // SAFETY: `arena.alloc` returns a non-null, initialized pointer backed by `arena: &'a Arena`,
        // which outlives `out: &mut Transpiler<'a>`, so borrowing it as `&'a Framework` is sound.
        out.options.framework = Some(unsafe { &*framework_view });
        out.options.inline_entrypoint_import_meta_main = true;
        if let Some(ignore) = bundler_options.ignore_dce_annotations {
            out.options.ignore_dce_annotations = ignore;
        }
        out.options.source_map = match mode {
            // Source maps must always be external, as DevServer special cases
            // the linking and part of the generation of these. It also relies
            // on source maps always being enabled.
            Mode::Development => bun_bundler::options::SourceMapOption::External,
            // TODO: follow user configuration
            Mode::ProductionDynamic | Mode::ProductionStatic => {
                bun_bundler::options::SourceMapOption::None
            }
        };
        if bundler_options.env != bun_schema::api::DotEnvBehavior::_none {
            out.options.env.behavior = bundler_options.env;
            out.options.env.prefix = bundler_options.env_prefix.unwrap_or(b"").into();
        }
        // The resolver crate carries a FORWARD_DECL subset of `BundleOptions`, so
        // re-project via the dedicated helper rather than `Clone`.
        out.sync_resolver_opts();

        out.configure_linker();
        out.configure_defines()?;
        out.options.jsx.development = mode == Mode::Development;

        bake_body::add_import_meta_defines(
            &mut out.options.define,
            mode,
            match renderer {
                Graph::Client => Side::Client,
                Graph::Server | Graph::Ssr => Side::Server,
            },
        )?;

        if (bundler_options.define.keys.len() + bundler_options.drop.count()) > 0 {
            debug_assert_eq!(
                bundler_options.define.keys.len(),
                bundler_options.define.values.len()
            );
            use bun_bundler::DefineDataExt;
            for (k, v) in bundler_options
                .define
                .keys
                .iter()
                .zip(bundler_options.define.values.iter())
            {
                let parsed =
                    bun_bundler::defines::DefineData::parse(k, v, false, false, log, arena)?;
                out.options.define.insert(k, parsed)?;
            }

            for drop_item in bundler_options.drop.keys() {
                if !drop_item.is_empty() {
                    let parsed = bun_bundler::defines::DefineData::parse(
                        drop_item, b"", true, true, log, arena,
                    )?;
                    out.options.define.insert(drop_item, parsed)?;
                }
            }
        }

        if mode != Mode::Development {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.chunk_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.asset_naming = b"_bun/[hash].[ext]".as_slice().into();
        }

        // Re-sync after define/naming mutations so the
        // resolver sees the final option set.
        out.sync_resolver_opts();
        Ok(framework_view)
    }

    /// Resolves built-in module
    /// specifiers and entry points against the resolvers; returns a clone
    /// with resolved paths. Errors written into `r.log`.
    pub fn resolve(
        &mut self,
        server: &mut bun_resolver::Resolver,
        client: &mut bun_resolver::Resolver,
        arena: &bun_alloc::Arena,
    ) -> crate::Result<()> {
        let mut had_errors = false;

        if let Some(rfr) = &mut self.react_fast_refresh {
            Self::resolve_helper(
                &self.built_in_modules,
                client,
                &mut rfr.import_source,
                &mut had_errors,
                b"react refresh runtime",
            );
        }
        if let Some(sc) = &mut self.server_components {
            Self::resolve_helper(
                &self.built_in_modules,
                server,
                &mut sc.server_runtime_import,
                &mut had_errors,
                b"server components runtime",
            );
        }
        for fsr in self.file_system_router_types.iter_mut() {
            let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
            fsr.root = Cow::Owned(
                bun_paths::resolve_path::join_abs::<bun_paths::platform::Auto>(
                    top_level_dir,
                    &fsr.root,
                )
                .to_vec(),
            );
            let _ = arena;
            if let Some(entry_client) = &mut fsr.entry_client {
                Self::resolve_helper(
                    &self.built_in_modules,
                    client,
                    entry_client,
                    &mut had_errors,
                    b"client side entrypoint",
                );
            }
            Self::resolve_helper(
                &self.built_in_modules,
                client,
                &mut fsr.entry_server,
                &mut had_errors,
                b"server side entrypoint",
            );
        }

        if had_errors {
            return Err(crate::Error::ModuleNotFound);
        }
        Ok(())
    }

    fn resolve_helper(
        built_in_modules: &bun_collections::StringArrayHashMap<BuiltInModule>,
        r: &mut bun_resolver::Resolver,
        path: &mut Cow<'static, [u8]>,
        had_errors: &mut bool,
        desc: &[u8],
    ) {
        if let Some(module) = built_in_modules.get(path) {
            if let BuiltInModule::Import(p) = module {
                *path = Cow::Owned(p.to_vec());
            }
            return;
        }
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        match r.resolve(top_level_dir, path, bun_ast::ImportKind::Stmt) {
            Ok(mut result) => {
                let p = result.path().expect("just resolved");
                *path = Cow::Owned(p.text.to_vec());
            }
            Err(err) => {
                // This routes through `Output::err` (stderr), not
                // `r.log`. The "Errors written into r.log" doc on `Framework.resolve`
                // refers to entries the resolver itself pushed; this top-level
                // "Failed to resolve" line goes to the terminal.
                bun_core::Output::err(
                    err,
                    "Failed to resolve '{s}' for framework ({s})",
                    (bstr::BStr::new(path), bstr::BStr::new(desc)),
                );
                *had_errors = true;
            }
        }
    }

    pub fn add_react_install_command_note(log: &mut bun_ast::Log) {
        log.add_msg(bun_ast::Msg {
            kind: bun_ast::Kind::Note,
            data: bun_ast::range_data(
                None,
                bun_ast::Range::NONE,
                concat!(
                    "Install the built in react integration with \"",
                    "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental",
                    "\"",
                ),
            ),
            ..Default::default()
        });
    }
}

/// `bake.SplitBundlerOptions` — per-graph bundler config + shared plugin.
#[derive(Default)]
pub struct SplitBundlerOptions {
    /// FFI: `jsc.API.JSBundler.Plugin` (`JSBundlerPlugin__create`); deinit
    /// goes through the C++ side. See LIFETIMES.tsv.
    pub plugin: Option<NonNull<jsc::Plugin>>,
    pub client: BuildConfigSubset,
    pub server: BuildConfigSubset,
    pub ssr: BuildConfigSubset,
}

// ─── bake_body → keystone bridges ────────────────────────────────────────────
// LAYERING: `UserOptions` (bake_body.rs) carries `&'static [u8]`-backed
// duplicates of `Framework`/`SplitBundlerOptions`; `DevServer::Options`
// (DevServer.rs) wants the keystone Cow-backed types defined above. Until the
// two struct families unify (tracked by the `convert_file_system_router_type`
// note in ServerConfig.rs), bridge by-value here so `server/mod.rs` can hand
// `config.bake` straight into `DevServer::init`. All `&'static [u8]` →
// `Cow::Borrowed` / `Box<[u8]>` projections are by-reference (no copy of the
// underlying arena bytes).
impl From<bake_body::FileSystemRouterType> for FileSystemRouterType {
    fn from(src: bake_body::FileSystemRouterType) -> Self {
        Self {
            root: Cow::Borrowed(src.root),
            prefix: Cow::Borrowed(src.prefix),
            entry_client: src.entry_client.map(Cow::Borrowed),
            entry_server: Cow::Borrowed(src.entry_server),
            ignore_underscores: src.ignore_underscores,
            ignore_dirs: src.ignore_dirs.iter().map(|s| Cow::Borrowed(*s)).collect(),
            extensions: src.extensions.iter().map(|s| Cow::Borrowed(*s)).collect(),
            style: src.style,
            allow_layouts: src.allow_layouts,
        }
    }
}
impl From<bake_body::ServerComponents> for ServerComponents {
    fn from(src: bake_body::ServerComponents) -> Self {
        Self {
            separate_ssr_graph: src.separate_ssr_graph,
            server_runtime_import: Cow::Borrowed(src.server_runtime_import),
            server_register_client_reference: Cow::Borrowed(src.server_register_client_reference),
            server_register_server_reference: Cow::Borrowed(src.server_register_server_reference),
            client_register_server_reference: Cow::Borrowed(src.client_register_server_reference),
        }
    }
}
impl From<bake_body::ReactFastRefresh> for ReactFastRefresh {
    fn from(src: bake_body::ReactFastRefresh) -> Self {
        Self {
            import_source: Cow::Borrowed(src.import_source),
        }
    }
}
impl From<bake_body::BuiltInModule> for BuiltInModule {
    fn from(src: bake_body::BuiltInModule) -> Self {
        match src {
            bake_body::BuiltInModule::Import(p) => BuiltInModule::Import(p.into()),
            bake_body::BuiltInModule::Code(c) => BuiltInModule::Code(c.into()),
        }
    }
}
impl From<bake_body::Framework> for Framework {
    fn from(src: bake_body::Framework) -> Self {
        let mut built_in_modules = bun_collections::StringArrayHashMap::new();
        for (k, v) in src.built_in_modules.iter() {
            bun_core::handle_oom(built_in_modules.put(*k, BuiltInModule::from(*v)));
        }
        Self {
            is_built_in_react: src.is_built_in_react,
            file_system_router_types: src
                .file_system_router_types
                .into_iter()
                .map(FileSystemRouterType::from)
                .collect(),
            server_components: src.server_components.map(ServerComponents::from),
            react_fast_refresh: src.react_fast_refresh.map(ReactFastRefresh::from),
            built_in_modules,
        }
    }
}
impl From<bake_body::BuildConfigSubset> for BuildConfigSubset {
    fn from(src: bake_body::BuildConfigSubset) -> Self {
        // `BuildConfigSubset` mirrors the field-set
        // `Framework::init_transpiler` reads (everything except `source_map`,
        // which only `init_transpiler_with_options` honours).
        Self {
            ignore_dce_annotations: src.ignore_dce_annotations,
            conditions: src.conditions,
            drop: src.drop,
            env: src.env,
            env_prefix: src.env_prefix,
            define: src.define,
            minify_syntax: src.minify_syntax,
            minify_identifiers: src.minify_identifiers,
            minify_whitespace: src.minify_whitespace,
        }
    }
}
impl From<bake_body::SplitBundlerOptions> for SplitBundlerOptions {
    fn from(src: bake_body::SplitBundlerOptions) -> Self {
        Self {
            // `bake_body::Plugin` and keystone `jsc::Plugin` both alias
            // `crate::api::js_bundler::Plugin` — same nominal type, no cast.
            plugin: src.plugin,
            client: src.client.into(),
            server: src.server.into(),
            ssr: src.ssr.into(),
        }
    }
}

/// `bake.SplitBundlerOptions.BuildConfigSubset`. Full body (with `from_js`)
/// lives in `bake_body.rs`; this keystone mirror carries every field that
/// `Framework::init_transpiler` reads so DevServer's
/// per-graph transpilers see bunfig `[serve.static]` define/env/conditions.
#[derive(Default)]
pub struct BuildConfigSubset {
    pub ignore_dce_annotations: Option<bool>,
    pub conditions: bun_collections::ArrayHashMap<&'static [u8], ()>,
    pub drop: bun_collections::ArrayHashMap<&'static [u8], ()>,
    pub env: bun_options_types::schema::api::DotEnvBehavior,
    pub env_prefix: Option<&'static [u8]>,
    pub define: bun_options_types::schema::api::StringMap,
    pub minify_syntax: Option<bool>,
    pub minify_identifiers: Option<bool>,
    pub minify_whitespace: Option<bool>,
    // `source_map` intentionally omitted — only
    // `init_transpiler_with_options` (bake_body) honours it, and DevServer
    // never calls that path.
}

/// `bake.HmrRuntime` — embedded HMR runtime code + precomputed line count.
/// Canonical definition; `bake_body::HmrRuntime` re-exports this
/// (`pub use super::HmrRuntime;`) so `bake_body::get_hmr_runtime` returns the
/// same nominal type IncrementalGraph names via `crate::bake::HmrRuntime`.
pub struct HmrRuntime {
    /// NUL-terminated; the sentinel is
    /// load-bearing where this buffer is handed to JSC/C++ as a C string.
    pub code: &'static bun_core::ZStr,
    pub line_count: u32,
}
pub use bake_body::get_hmr_runtime;
// (Former `__bun_bake_get_hmr_runtime` link-time bridge deleted —
// `bun_bundler::bake_types::get_hmr_runtime` now loads the codegen bytes
// itself via `bun_core::runtime_embed_file!`, so the storage moved DOWN and
// the cross-crate hook is gone. This crate's `HmrRuntime` keeps the
// NUL-terminated `&ZStr` form for JSC handoff; the bundler-side one is plain
// `&[u8]`.)

pub use bake_body::StringRefList;

// ══════════════════════════════════════════════════════════════════════════
// FrameworkRouter
// ══════════════════════════════════════════════════════════════════════════
pub mod framework_router {
    // Everything is re-exported from `framework_router_body`
    // (FrameworkRouter.rs) so `framework_router::X` ≡
    // `framework_router_body::X` and the real method bodies resolve directly.
    /// `generated_js2native.rs` lowers `JSFrameworkRouter.getBindings` to
    /// `framework_router::js_framework_router::get_bindings`; alias the type so
    /// the associated-fn path resolves.
    pub use super::framework_router_body::JSFrameworkRouter as js_framework_router;
    pub use super::framework_router_body::{
        DynamicRouteMap, EncodedPattern, FileKind, FrameworkRouter, InsertionHandler,
        JSFrameworkRouter, MatchedParams, OpaqueFileId, OpaqueFileIdOptional, Part, Route,
        RouteIndex, StaticRouteMap, Style, TinyLog, Type, TypeIndex,
    };

    /// `wrap` shim over the trait-object form (`&mut dyn InsertionHandler`),
    /// kept so callsites read `InsertionContext::wrap(&mut ctx)`.
    pub(crate) enum InsertionContext {}
    impl InsertionContext {
        /// Thin shim over the trait-object form (`&mut dyn InsertionHandler`).
        #[inline]
        pub(crate) fn wrap<T: InsertionHandler>(ctx: &mut T) -> &mut dyn InsertionHandler {
            ctx
        }
    }
}
pub use framework_router as FrameworkRouter;

// ══════════════════════════════════════════════════════════════════════════
// production
// ══════════════════════════════════════════════════════════════════════════
pub mod production {
    pub use super::production_body::{EntryPointMap, PerThread, TypeAndFlags, build_command};
}

// ══════════════════════════════════════════════════════════════════════════
// DevServer
// ══════════════════════════════════════════════════════════════════════════
pub mod dev_server;
pub use dev_server as DevServer;
