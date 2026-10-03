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
// `bake_body.rs` carries `UserOptions`, the Framework/BuildConfigSubset `from_js`
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
pub(crate) mod source_provider_exports;

pub(crate) use bake_body::{PatternBuffer, UserOptions, print_warning};

/// All bake JSC references go through this re-export of `bun_jsc`.
pub(crate) mod jsc {
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

pub(crate) use bun_bundler::bake_types::BuiltInModule;
/// `bake.Side` / `bake.Graph` — these are TYPE_ONLY moved-down into
/// `bun_bundler::bake_types` (lower tier owns the canonical defs so the
/// bundler can name them without depending on `bun_runtime`). Re-export
/// here so intra-crate `bake::Side` paths resolve.
pub(crate) use bun_bundler::bake_types::{Graph, Side};

/// `bake.Mode` — canonical definition. `bake_body::Mode` re-exports this
/// (`pub use super::Mode;`) so both paths name the same nominal type.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum Mode {
    Development,
    ProductionStatic,
}

impl Mode {
    pub(crate) fn output_format(self) -> bun_bundler::options::Format {
        match self {
            Mode::Development => bun_bundler::options::Format::InternalBakeDev,
            Mode::ProductionStatic => bun_bundler::options::Format::Esm,
        }
    }
}

/// `bake.Framework.ServerComponents`.
///
/// In this and the types below, `Cow::Borrowed` is a literal default and
/// `Cow::Owned` came from the user's configuration or the resolver.
#[derive(Clone)]
pub(crate) struct ServerComponents {
    pub(crate) separate_ssr_graph: bool,
    /// REQUIRED — `fromJS` throws if `serverRuntimeImportSource` is absent.
    pub(crate) server_runtime_import: Cow<'static, [u8]>,
    pub(crate) server_register_client_reference: Cow<'static, [u8]>,
    pub(crate) server_register_server_reference: Cow<'static, [u8]>,
    pub(crate) client_register_server_reference: Cow<'static, [u8]>,
}

impl ServerComponents {
    pub(crate) fn new(server_runtime_import: Cow<'static, [u8]>) -> Self {
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
pub(crate) struct ReactFastRefresh {
    pub(crate) import_source: Cow<'static, [u8]>,
}

impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self {
            import_source: Cow::Borrowed(b"react-refresh/runtime"),
        }
    }
}

/// `bake.Framework.FileSystemRouterType`.
pub(crate) struct FileSystemRouterType {
    pub(crate) root: Cow<'static, [u8]>,
    pub(crate) prefix: Cow<'static, [u8]>,
    pub(crate) entry_client: Option<Cow<'static, [u8]>>,
    /// REQUIRED — `fromJS` throws if missing; `Framework.resolve`
    /// dereferences unconditionally.
    pub(crate) entry_server: Cow<'static, [u8]>,
    pub(crate) ignore_underscores: bool,
    pub(crate) ignore_dirs: Vec<Cow<'static, [u8]>>,
    pub(crate) extensions: Vec<Cow<'static, [u8]>>,
    pub(crate) style: framework_router::Style,
    pub(crate) allow_layouts: bool,
}

/// A "Framework" is simply a set of bundler options that a framework author
/// would set in order to integrate with the application. The default is
/// unopinionated. `from_js`, `react` and `auto` live in `bake_body.rs`.
///
/// Full documentation on these fields is located in the TypeScript definitions.
#[derive(Default)]
pub(crate) struct Framework {
    pub(crate) is_built_in_react: bool,
    /// Owned `Vec` so `resolve()` can take `&mut` and rewrite entries in
    /// place; freed by `Vec::drop`.
    pub(crate) file_system_router_types: Vec<FileSystemRouterType>,
    pub(crate) server_components: Option<ServerComponents>,
    pub(crate) react_fast_refresh: Option<ReactFastRefresh>,
    pub(crate) built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
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

    /// [`Framework::init_transpiler_with_options`] with the options a mode implies.
    /// Returns the arena slot for the `bake_types::Framework` projection; caller must `drop_in_place` it.
    pub(crate) fn init_transpiler<'a>(
        &mut self,
        arena: &'a bun_alloc::Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
    ) -> crate::Result<*mut bun_bundler::bake_types::Framework> {
        self.init_transpiler_with_options(
            arena,
            log,
            mode,
            renderer,
            out,
            bundler_options,
            match mode {
                // Source maps must always be external, as DevServer special cases
                // the linking and part of the generation of these. It also relies
                // on source maps always being enabled.
                Mode::Development => bun_bundler::options::SourceMapOption::External,
                // TODO: follow user configuration
                Mode::ProductionStatic => bun_bundler::options::SourceMapOption::None,
            },
            None,
            None,
            None,
        )
    }

    /// Resolves built-in module
    /// specifiers and entry points against the resolvers, in place.
    /// Errors written into `r.log`.
    pub(crate) fn resolve(
        &mut self,
        server: &mut bun_resolver::Resolver,
        client: &mut bun_resolver::Resolver,
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

    pub(crate) fn add_react_install_command_note(log: &mut bun_ast::Log) {
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
pub(crate) struct SplitBundlerOptions {
    /// FFI: `jsc.API.JSBundler.Plugin` (`JSBundlerPlugin__create`); deinit
    /// goes through the C++ side. See LIFETIMES.tsv.
    pub(crate) plugin: Option<NonNull<jsc::Plugin>>,
    pub(crate) client: BuildConfigSubset,
    pub(crate) server: BuildConfigSubset,
    pub(crate) ssr: BuildConfigSubset,
}

/// `bake.SplitBundlerOptions.BuildConfigSubset`.
pub(crate) struct BuildConfigSubset {
    pub(crate) ignore_dce_annotations: Option<bool>,
    pub(crate) conditions: bun_collections::ArrayHashMap<&'static [u8], ()>,
    pub(crate) drop: bun_collections::ArrayHashMap<&'static [u8], ()>,
    pub(crate) env: bun_options_types::schema::api::DotEnvBehavior,
    pub(crate) env_prefix: Option<Box<[u8]>>,
    pub(crate) define: bun_options_types::schema::api::StringMap,
    pub(crate) source_map: bun_options_types::schema::api::SourceMapMode,

    pub(crate) minify_syntax: Option<bool>,
    pub(crate) minify_identifiers: Option<bool>,
    pub(crate) minify_whitespace: Option<bool>,
}

impl Default for BuildConfigSubset {
    fn default() -> Self {
        use bun_options_types::schema::api;
        BuildConfigSubset {
            ignore_dce_annotations: None,
            conditions: bun_collections::ArrayHashMap::new(),
            drop: bun_collections::ArrayHashMap::new(),
            env: api::DotEnvBehavior::_none,
            env_prefix: None,
            define: api::StringMap::EMPTY,
            source_map: api::SourceMapMode::External,

            minify_syntax: None,
            minify_identifiers: None,
            minify_whitespace: None,
        }
    }
}

/// `bake.HmrRuntime` — embedded HMR runtime code + precomputed line count.
/// Canonical definition; `bake_body::HmrRuntime` re-exports this
/// (`pub use super::HmrRuntime;`) so `bake_body::get_hmr_runtime` returns the
/// same nominal type IncrementalGraph names via `crate::bake::HmrRuntime`.
pub(crate) struct HmrRuntime {
    /// NUL-terminated; the sentinel is
    /// load-bearing where this buffer is handed to JSC/C++ as a C string.
    pub(crate) code: &'static bun_core::ZStr,
    pub(crate) line_count: u32,
}
pub(crate) use bake_body::get_hmr_runtime;
// (Former `__bun_bake_get_hmr_runtime` link-time bridge deleted —
// `bun_bundler::bake_types::get_hmr_runtime` now loads the codegen bytes
// itself via `bun_core::runtime_embed_file!`, so the storage moved DOWN and
// the cross-crate hook is gone. This crate's `HmrRuntime` keeps the
// NUL-terminated `&ZStr` form for JSC handoff; the bundler-side one is plain
// `&[u8]`.)

// ══════════════════════════════════════════════════════════════════════════
// FrameworkRouter
// ══════════════════════════════════════════════════════════════════════════
pub(crate) mod framework_router {
    // Everything is re-exported from `framework_router_body`
    // (FrameworkRouter.rs) so `framework_router::X` ≡
    // `framework_router_body::X` and the real method bodies resolve directly.
    /// `generated_js2native.rs` lowers `JSFrameworkRouter.getBindings` to
    /// `framework_router::js_framework_router::get_bindings`; alias the type so
    /// the associated-fn path resolves.
    pub(crate) use super::framework_router_body::JSFrameworkRouter as js_framework_router;
    pub(crate) use super::framework_router_body::{
        FileKind, FrameworkRouter, InsertionHandler, JSFrameworkRouter, MatchedParams,
        OpaqueFileId, OpaqueFileIdOptional, Part, RouteIndex, Style, TinyLog, Type,
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

// ══════════════════════════════════════════════════════════════════════════
// production
// ══════════════════════════════════════════════════════════════════════════
pub(crate) mod production {
    pub(crate) use super::production_body::{PerThread, build_command};
}

// ══════════════════════════════════════════════════════════════════════════
// DevServer
// ══════════════════════════════════════════════════════════════════════════
pub(crate) mod dev_server;
pub(crate) use dev_server as DevServer;
