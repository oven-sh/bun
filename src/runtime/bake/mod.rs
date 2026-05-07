//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
//!
//! B-2 keystone L: DevServer struct + lifecycle un-gated. Heavy method bodies
//! (request handling, finalize_bundle, hot-update tracing) remain in the gated
//! Phase-A draft `DevServer.rs` and submodule drafts; they are blocked on
//! `bun_jsc` method surface and `bun_bundler::BundleV2` field access (both
//! currently opaque). Type identity is real here so downstream `server/` and
//! the `bun_bundler::dispatch::DevServerVTable` can be wired.

use core::ptr::NonNull;
use std::borrow::Cow;

// ─── Phase-A drafts ──────────────────────────────────────────────────────────
// `bake_body.rs` (Framework/UserOptions/BuildConfigSubset `from_js` + the
// `init_server_runtime`/`get_hmr_runtime` host fns) is un-gated here so the
// keystone types above stop being opaque `(())` shells. DevServer/
// FrameworkRouter/production drafts stay gated — they need BundleV2 field
// access and the full IncrementalGraph surface.
#[path = "bake_body.rs"]
pub(crate) mod bake_body;

#[path = "DevServer.rs"]
mod dev_server_body;
pub(crate) use dev_server_body::get_deinit_count_for_testing;

#[path = "FrameworkRouter.rs"]
pub(crate) mod framework_router_body;

#[path = "production.rs"]
mod production_body;

// Re-exports from the full Phase-A drafts so `production.rs` can name them
// without going through the keystone stubs below.
pub use bake_body::{print_warning, PatternBuffer, UserOptions};

/// All bake JSC references go through this re-export of `bun_jsc`.
pub(crate) mod jsc {
    pub use crate::jsc::*;
    pub use bun_jsc::virtual_machine::VirtualMachine;
    pub use bun_jsc::debugger::DebuggerId;
    /// `jsc.API.JSBundler.Plugin` — the C++ `BunPlugin` FFI handle. The
    /// canonical opaque struct lives in `bun_bundler::bundle_v2::api::JSBundler`
    /// (T5) and is re-exported through `crate::api::js_bundler` so the
    /// JSC-aware `PluginJscExt` methods are in scope; both paths name the same
    /// nominal type.
    pub use crate::api::js_bundler::Plugin;
}

/// export default { app: ... };
pub const API_NAME: &str = "app";

// ══════════════════════════════════════════════════════════════════════════
// bake.zig top-level types
// ══════════════════════════════════════════════════════════════════════════

/// `bake.Side` / `bake.Graph` — these are TYPE_ONLY moved-down into
/// `bun_bundler::bake_types` (lower tier owns the canonical defs so the
/// bundler can name them without depending on `bun_runtime`). Re-export
/// here so intra-crate `bake::Side` paths resolve.
pub use bun_bundler::bake_types::{Graph, Side};
pub use bun_bundler::bake_types::BuiltInModule;

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
/// PORT NOTE: string fields are arena-backed at runtime (freed via
/// `UserOptions.arena.deinit()`, bake.zig:23) but default to static literals
/// (bake.zig:360-367). `Cow<'static, [u8]>` covers both without leaking.
#[derive(Clone)]
pub struct ServerComponents {
    pub separate_ssr_graph: bool,
    /// REQUIRED — spec (bake.zig:360) gives no default; `fromJS` throws if
    /// `serverRuntimeImportSource` is absent (bake.zig:511-513).
    pub server_runtime_import: Cow<'static, [u8]>,
    pub server_register_client_reference: Cow<'static, [u8]>,
    pub server_register_server_reference: Cow<'static, [u8]>,
    pub client_register_server_reference: Cow<'static, [u8]>,
}
// PORT NOTE: no `Default` impl — `server_runtime_import` is a required field
// in the spec (bake.zig:360 has no `= "..."` initializer). Callers must
// supply it explicitly (`Framework::react()` sets `"react-server-dom-bun/server"`).
impl ServerComponents {
    /// Construct with the spec defaults for the three `register*` exports
    /// (bake.zig:362-367); `server_runtime_import` must be supplied.
    pub fn new(server_runtime_import: Cow<'static, [u8]>) -> Self {
        Self {
            separate_ssr_graph: false,
            server_runtime_import,
            server_register_client_reference: Cow::Borrowed(b"registerClientReference"),
            server_register_server_reference: Cow::Borrowed(b"registerServerReference"),
            client_register_server_reference: Cow::Borrowed(b"registerServerReference"),
        }
    }
}

#[derive(Clone)]
pub struct ReactFastRefresh {
    pub import_source: Cow<'static, [u8]>,
}
impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self { import_source: Cow::Borrowed(b"react-refresh/runtime") }
    }
}

/// `bake.Framework.FileSystemRouterType`. Full body (with `Style` enum and
/// `from_js`) lives in the gated `bake_body.rs` draft; only the field set
/// DevServer touches is named here.
// PORT NOTE: dropped `#[derive(Clone)]` — `framework_router::Style` is now the
// body enum (carries `JavascriptDefined(jsc::Strong)`, not `Clone`). Spec
// `Style` has a `deinit()` (FrameworkRouter.zig), so it was never trivially
// copyable.
pub struct FileSystemRouterType {
    pub root: Cow<'static, [u8]>,
    pub prefix: Cow<'static, [u8]>,
    pub entry_client: Option<Cow<'static, [u8]>>,
    /// REQUIRED — spec bake.zig:346 is `[]const u8` (non-optional). `fromJS`
    /// throws if missing (bake.zig:573-575); `Framework.resolve` (bake.zig:404)
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
    /// Spec (bake.zig:248) is `[]FileSystemRouterType` — a *mutable*
    /// arena-owned slice that `Framework.resolve` (bake.zig:401-404) rewrites
    /// in place. Owned `Vec` so `resolve()` can take `&mut` and so the arena
    /// free in `UserOptions::drop` is mirrored by `Vec::drop`.
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
    /// `out.options.framework` (spec bake.zig:778 `out.options.framework =
    /// framework`).
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
        let server_components = self.server_components.as_ref().map(|sc| bt::ServerComponents {
            separate_ssr_graph: sc.separate_ssr_graph,
            server_runtime_import: sc.server_runtime_import.as_ref().into(),
            server_register_client_reference: sc.server_register_client_reference.as_ref().into(),
            server_register_server_reference: sc.server_register_server_reference.as_ref().into(),
            client_register_server_reference: sc.client_register_server_reference.as_ref().into(),
        });
        let react_fast_refresh = self.react_fast_refresh.as_ref().map(|rfr| bt::ReactFastRefresh {
            import_source: rfr.import_source.as_ref().into(),
        });
        bt::Framework::new(
            built_in_modules,
            server_components,
            react_fast_refresh,
            self.is_built_in_react,
        )
    }

    /// `bake.Framework.initTranspiler` (bake.zig:663). Sets up a per-graph
    /// `Transpiler` in place. The full body lives in
    /// `bake_body::Framework::init_transpiler_with_options`; this keystone
    /// version operates on the keystone `BuildConfigSubset` (which omits
    /// `conditions`/`env`/`define`/`drop` until the schema types are
    /// const-constructible — those paths default).
    pub fn init_transpiler<'a>(
        &mut self,
        arena: &'a bun_alloc::Arena,
        log: &mut bun_logger::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
    ) -> Result<(), bun_core::Error> {
        use bun_options_types::schema as bun_schema;

        let mut ast_memory_allocator =
            bun_js_parser::ASTMemoryAllocator::new_without_stack(arena);
        let ast_scope = ast_memory_allocator.enter();
        let _guard = scopeguard::guard(ast_scope, |s| s.exit());

        let out: &mut bun_bundler::Transpiler = out.write(bun_bundler::Transpiler::init(
            arena,
            log,
            bun_schema::api::TransformOptions::default(),
            None,
        )?);

        out.options.target = match renderer {
            Graph::Client => bun_bundler::options::Target::Browser,
            Graph::Server | Graph::Ssr => bun_bundler::options::Target::Bun,
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

        out.options.react_fast_refresh =
            mode == Mode::Development && renderer == Graph::Client && self.react_fast_refresh.is_some();
        out.options.server_components = self.server_components.is_some();

        out.options.conditions = bun_bundler::options::ESMConditions::init(
            out.options.target.default_conditions(),
            out.options.target.is_server_side(),
            &[],
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
        // Spec `initTranspiler` (bake.zig:681-692) forwards `null,null,null` for
        // the three minify overrides into `initTranspilerWithOptions`, so the
        // wrapper always defaults them to `mode != .development` regardless of
        // `BuildConfigSubset`. User-supplied minify flags are only honored by
        // `init_transpiler_with_options` (bake_body).
        out.options.minify_syntax = mode != Mode::Development;
        out.options.minify_identifiers = mode != Mode::Development;
        out.options.minify_whitespace = mode != Mode::Development;
        out.options.css_chunking = true;
        // Spec bake.zig:778 `out.options.framework = framework` stores a borrowed
        // `*bake.Framework`. The bundler crate (lower tier) carries a TYPE_ONLY
        // projection (`bake_types::Framework`); construct it here and give it
        // arena lifetime so `BundleOptions<'a>` can borrow it for the bundle pass.
        // PERF(port): interior `Box<[u8]>` in the projection are not dropped by
        // bumpalo — bounded per-session, revisit when `bake_types::BuiltInModule`
        // is reshaped to `&'a [u8]`.
        out.options.framework = Some(&*arena.alloc(self.as_bundler_view()));
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
        // PORT NOTE: spec bake.zig:784-787 also applies `bundler_options.env` /
        // `env_prefix` here; the keystone `BuildConfigSubset` omits those fields
        // until the schema types are const-constructible (see `_blocked_tail`),
        // so the `env != ._none` branch is a no-op and elided.
        // Spec bake.zig:788 `out.resolver.opts = out.options` (struct copy). The
        // resolver crate carries a FORWARD_DECL subset of `BundleOptions`, so
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

        if mode != Mode::Development {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.chunk_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.asset_naming = b"_bun/[hash].[ext]".as_slice().into();
        }

        // Spec bake.zig:821 — re-sync after define/naming mutations so the
        // resolver sees the final option set.
        out.sync_resolver_opts();
        Ok(())
    }

    /// `bake.Framework.resolve` (bake.zig:401). Resolves built-in module
    /// specifiers and entry points against the resolvers; returns a clone
    /// with resolved paths. Errors written into `r.log`.
    pub fn resolve(
        &mut self,
        server: &mut bun_resolver::Resolver,
        client: &mut bun_resolver::Resolver,
        arena: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error> {
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
            // SAFETY: `Resolver.fs` is the `*mut FileSystem` singleton (LIFETIMES.tsv
            // JSC_BORROW), live for the resolver's lifetime.
            let top_level_dir = unsafe { (*server.fs).top_level_dir };
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
            return Err(bun_core::err!("ModuleNotFound"));
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
        // SAFETY: `Resolver.fs` is the `*mut FileSystem` singleton, live for
        // the resolver's lifetime.
        let top_level_dir = unsafe { (*r.fs).top_level_dir };
        match r.resolve(top_level_dir, path, bun_options_types::ImportKind::Stmt) {
            Ok(mut result) => {
                let p = result.path().expect("just resolved");
                *path = Cow::Owned(p.text.to_vec());
            }
            Err(err) => {
                // Spec bake.zig:422 routes through `bun.Output.err` (stderr), not
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

    /// `bake.Framework.react_install_command` (bake.zig:373).
    pub const REACT_INSTALL_COMMAND: &str =
        "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental";

    /// `bake.Framework.addReactInstallCommandNote` (bake.zig:375).
    pub fn add_react_install_command_note(log: &mut bun_logger::Log) {
        bun_core::handle_oom(log.add_msg(bun_logger::Msg {
            kind: bun_logger::Kind::Note,
            data: bun_logger::range_data(
                None,
                bun_logger::Range::NONE,
                concat!(
                    "Install the built in react integration with \"",
                    "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental",
                    "\"",
                ),
            ),
            ..Default::default()
        }));
    }
}

/// `bake.SplitBundlerOptions` — per-graph bundler config + shared plugin.
pub struct SplitBundlerOptions {
    /// FFI: `jsc.API.JSBundler.Plugin` (`JSBundlerPlugin__create`); deinit
    /// goes through the C++ side. See LIFETIMES.tsv.
    pub plugin: Option<NonNull<jsc::Plugin>>,
    pub client: BuildConfigSubset,
    pub server: BuildConfigSubset,
    pub ssr: BuildConfigSubset,
}
impl Default for SplitBundlerOptions {
    fn default() -> Self {
        Self { plugin: None, client: Default::default(), server: Default::default(), ssr: Default::default() }
    }
}

// ─── bake_body → keystone bridges ────────────────────────────────────────────
// LAYERING: `UserOptions` (bake_body.rs) carries the `&'static [u8]`-backed
// Phase-A duplicates of `Framework`/`SplitBundlerOptions`; `DevServer::Options`
// (DevServer.rs) wants the keystone Cow-backed types defined above. Both
// mirror the single Zig `bake.Framework`/`bake.SplitBundlerOptions`. Until the
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
        Self { import_source: Cow::Borrowed(src.import_source) }
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
        // PORT NOTE: keystone `BuildConfigSubset` is the field-subset
        // `Framework::init_transpiler` actually reads today; the wider
        // `bake_body` shape (loader/conditions/drop/env/define/source_map) is
        // applied by `bake_body::Framework::init_transpiler_with_options` and
        // is dropped here pending the schema-type un-gate (see TODO at the
        // struct def below).
        Self {
            ignore_dce_annotations: src.ignore_dce_annotations,
            minify_syntax: src.minify_syntax,
            minify_identifiers: src.minify_identifiers,
            minify_whitespace: src.minify_whitespace,
            _blocked_tail: (),
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
/// lives in the gated `bake_body.rs` draft; struct shape un-gated so
/// `SplitBundlerOptions` is real.
#[derive(Default)]
pub struct BuildConfigSubset {
    pub ignore_dce_annotations: Option<bool>,
    pub minify_syntax: Option<bool>,
    pub minify_identifiers: Option<bool>,
    pub minify_whitespace: Option<bool>,
    // TODO(b2-blocked): bun_schema::api::{LoaderMap,DotEnvBehavior,StringMap,SourceMapMode}
    //   — remaining fields gated until `bun_interchange` schema types are
    //   const-constructible. See `bake_body.rs` for the full set.
    _blocked_tail: (),
}

/// `bake.HmrRuntime` — embedded HMR runtime code + precomputed line count.
/// Canonical definition; `bake_body::HmrRuntime` re-exports this
/// (`pub use super::HmrRuntime;`) so `bake_body::get_hmr_runtime` returns the
/// same nominal type IncrementalGraph names via `crate::bake::HmrRuntime`.
pub struct HmrRuntime {
    /// Spec bake.zig:841 is `[:0]const u8` — NUL-terminated; the sentinel is
    /// load-bearing where this buffer is handed to JSC/C++ as a C string.
    pub code: &'static bun_str::ZStr,
    pub line_count: u32,
}
pub use bake_body::get_hmr_runtime;

/// One-time registration of the bundler-side HMR-runtime loader. The bundler
/// crate (`bun_bundler::bake_types`) cannot embed `bake.client.js`/
/// `bake.server.js` itself (those are T6 codegen artifacts), so it consults a
/// `OnceLock<fn(Side) -> HmrRuntime>` that this crate fills in. Call once at
/// process init (DevServer/BundleThread startup).
pub fn register_bundler_hmr_runtime_loader() {
    bun_bundler::bake_types::set_hmr_runtime_loader(|side| {
        let rt = bake_body::get_hmr_runtime(side);
        bun_bundler::bake_types::HmrRuntime {
            code: rt.code.as_bytes(),
            line_count: rt.line_count,
        }
    });
}

// `bake.UserOptions` — top-level JS-facing options struct. Full body (with
// `from_js`) lives in the un-gated `bake_body.rs` draft and is re-exported
// above; the keystone `(())` stub is gone now that `bake_body` compiles.
pub use bake_body::StringRefList;

// ══════════════════════════════════════════════════════════════════════════
// FrameworkRouter
// ══════════════════════════════════════════════════════════════════════════
pub mod framework_router {
    // PORT NOTE: this module used to carry duplicate "keystone" stub structs
    // (`Route`, `Type`, `FrameworkRouter`, `MatchedParams`, `EncodedPattern`)
    // alongside the real defs in `framework_router_body` (FrameworkRouter.rs).
    // The two nominal type sets diverged and forced placeholder shims. The body
    // module is now fully ported and un-gated, so re-export everything so
    // `framework_router::X` ≡ `framework_router_body::X` and the real method
    // bodies (`init_empty`, `match_slow`, `memory_cost`, `to_js`, …) resolve
    // directly.
    pub use super::framework_router_body::{
        DynamicRouteMap, EncodedPattern, FileKind, FrameworkRouter, InsertionHandler,
        JSFrameworkRouter, MatchedParams, OpaqueFileId, OpaqueFileIdOptional, Part, Route,
        RouteIndex, StaticRouteMap, Style, TinyLog, Type, TypeIndex,
    };
    /// `generated_js2native.rs` lowers `JSFrameworkRouter.getBindings` to
    /// `framework_router::js_framework_router::get_bindings`; alias the type so
    /// the associated-fn path resolves.
    pub use super::framework_router_body::JSFrameworkRouter as js_framework_router;

    /// `FrameworkRouter.InsertionContext` — Zig used an `*anyopaque` +
    /// comptime fn-ptr `VTable` pair with a `wrap(T, ptr)` helper that
    /// generated trampolines. The Rust port maps that to a trait object
    /// (`&mut dyn InsertionHandler`); this is the `wrap` shim only, kept so
    /// callsites read `InsertionContext::wrap(&mut ctx)` like the spec.
    pub enum InsertionContext {}
    impl InsertionContext {
        /// Zig: `InsertionContext.wrap(T, ptr)` — comptime vtable generation.
        /// Port: thin shim over the trait-object form (`&mut dyn InsertionHandler`).
        #[inline]
        pub fn wrap<T: InsertionHandler>(ctx: &mut T) -> &mut dyn InsertionHandler {
            ctx
        }
    }
}
pub use framework_router as FrameworkRouter;

// ══════════════════════════════════════════════════════════════════════════
// production
// ══════════════════════════════════════════════════════════════════════════
pub mod production {
    pub use super::production_body::{
        build_command, EntryPointHashMap, EntryPointMap, InputFile, PerThread, TypeAndFlags,
    };
}

// ══════════════════════════════════════════════════════════════════════════
// DevServer
// ══════════════════════════════════════════════════════════════════════════
pub mod dev_server;
pub use dev_server as DevServer;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/bake.zig
//   confidence: medium (B-2 keystone-L un-gate: structs + vtable wired)
//   notes:      method bodies remain in gated drafts; blocked on bun_jsc +
//               bun_bundler::BundleV2 field access.
// ──────────────────────────────────────────────────────────────────────────
