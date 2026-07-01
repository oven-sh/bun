//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
//!
//! This file holds the keystone DevServer struct + lifecycle so downstream
//! `server/` and the `bun_bundler::dispatch::DevServerHandle` can be wired.
//! The heavy method bodies (request handling, finalize_bundle, hot-update
//! tracing) live in `DevServer.rs` and the other `#[path]` submodules below.

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
    pub(crate) use bun_jsc::debugger::DebuggerId;
    pub(crate) use bun_jsc::*;
}

pub const API_NAME: &str = "app";

// ══════════════════════════════════════════════════════════════════════════
// Top-level types
// ══════════════════════════════════════════════════════════════════════════

pub use bun_bundler::bake_types::BuiltInModule;
use bun_bundler::bake_types::{Graph, Side};

/// `bake.Mode` — canonical definition. `bake_body::Mode` re-exports this
/// (`pub use super::Mode;`) so both paths name the same nominal type.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mode {
    Development,
    ProductionDynamic,
    ProductionStatic,
}

/// Canonical defs live in `bun_bundler::bake_types` (the bundler reads these
/// fields); one nominal type shared by runtime and bundler.
pub use bun_bundler::bake_types::{ReactFastRefresh, ServerComponents};

/// `bake.Framework.FileSystemRouterType`. Full body (with `Style` enum and
/// `from_js`) lives in the gated `bake_body.rs` draft; only the field set
/// DevServer touches is named here.
#[derive(Clone)]
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
#[derive(Default)]
pub struct Framework {
    /// The bundler-visible option set — the canonical
    /// `bun_options_types::bake::Framework` (re-exported as
    /// `bun_bundler::bake_types::Framework`). Embedded, not mirrored.
    pub view: bun_bundler::bake_types::Framework,
    /// Runtime-only: owned `Vec` so `resolve()` can take `&mut` and rewrite
    /// entries in place; freed by `Vec::drop`.
    pub file_system_router_types: Vec<FileSystemRouterType>,
}

impl Framework {
    /// Bundler-side view of this Framework: a deep clone of the embedded
    /// canonical `bake_types::Framework`.
    pub(crate) fn as_bundler_view(&self) -> bun_bundler::bake_types::Framework {
        self.view.deep_clone()
    }

    /// Sets up a per-graph `Transpiler` in place with the mode-derived
    /// source-map/minify defaults. Returns the arena slot for the
    /// `bake_types::Framework` projection; caller must `drop_in_place` it.
    pub fn init_transpiler<'a>(
        &mut self,
        arena: &'a bun_alloc::Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
    ) -> Result<*mut bun_bundler::bake_types::Framework, bun_core::Error> {
        let source_map = match mode {
            // Source maps must always be external, as DevServer special cases
            // the linking and part of the generation of these. It also relies
            // on source maps always being enabled.
            Mode::Development => bun_bundler::options::SourceMapOption::External,
            // TODO: follow user configuration
            Mode::ProductionDynamic | Mode::ProductionStatic => {
                bun_bundler::options::SourceMapOption::None
            }
        };
        self.init_transpiler_with_options(
            arena,
            log,
            mode,
            renderer,
            out,
            bundler_options,
            source_map,
            None,
            None,
            None,
        )
    }

    /// Resolves built-in module
    /// specifiers and entry points against the resolvers; returns a clone
    /// with resolved paths. Errors written into `r.log`.
    pub fn resolve(
        &mut self,
        server: &mut bun_resolver::Resolver,
        client: &mut bun_resolver::Resolver,
        arena: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error> {
        let mut had_errors = false;

        if let Some(rfr) = &mut self.view.react_fast_refresh {
            Self::resolve_helper(
                &self.view.built_in_modules,
                client,
                &mut rfr.import_source,
                &mut had_errors,
                b"react refresh runtime",
            );
        }
        if let Some(sc) = &mut self.view.server_components {
            Self::resolve_helper(
                &self.view.built_in_modules,
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
                    &self.view.built_in_modules,
                    client,
                    entry_client,
                    &mut had_errors,
                    b"client side entrypoint",
                );
            }
            Self::resolve_helper(
                &self.view.built_in_modules,
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

    fn resolve_helper<T: From<Vec<u8>> + core::ops::Deref<Target = [u8]>>(
        built_in_modules: &bun_collections::StringArrayHashMap<BuiltInModule>,
        r: &mut bun_resolver::Resolver,
        path: &mut T,
        had_errors: &mut bool,
        desc: &[u8],
    ) {
        if let Some(module) = built_in_modules.get(&**path) {
            if let BuiltInModule::Import(p) = module {
                *path = T::from(p.to_vec());
            }
            return;
        }
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        match r.resolve(top_level_dir, &**path, bun_ast::ImportKind::Stmt) {
            Ok(mut result) => {
                let p = result.path().expect("just resolved");
                *path = T::from(p.text.to_vec());
            }
            Err(err) => {
                // This routes through `Output::err` (stderr), not
                // `r.log`. The "Errors written into r.log" doc on `Framework.resolve`
                // refers to entries the resolver itself pushed; this top-level
                // "Failed to resolve" line goes to the terminal.
                bun_core::Output::err(
                    err,
                    "Failed to resolve '{s}' for framework ({s})",
                    (bstr::BStr::new(&**path), bstr::BStr::new(desc)),
                );
                *had_errors = true;
            }
        }
    }

    pub const REACT_INSTALL_COMMAND: &str = "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental";

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

/// `bake.SplitBundlerOptions` / `bake.BuildConfigSubset` — canonical defs
/// (with `from_js`) live in `bake_body.rs`; one nominal type each.
pub use bake_body::{BuildConfigSubset, SplitBundlerOptions};

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
    pub use super::production_body::{PerThread, TypeAndFlags, build_command};
}

// ══════════════════════════════════════════════════════════════════════════
// DevServer
// ══════════════════════════════════════════════════════════════════════════
pub mod dev_server;
pub use dev_server as DevServer;
