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

// ─── gated Phase-A drafts (full bodies preserved, not compiled) ──────────────
#[cfg(any())]
#[path = "bake_body.rs"]
mod bake_body;
#[cfg(any())]
#[path = "DevServer.rs"]
mod dev_server_body;
#[cfg(any())]
#[path = "FrameworkRouter.rs"]
mod framework_router_body;
#[cfg(any())]
#[path = "production.rs"]
mod production_body;

/// All bake JSC references go through this re-export of `bun_jsc`.
pub(crate) mod jsc {
    pub use crate::jsc::*;
    pub use bun_jsc::virtual_machine::VirtualMachine;
    pub use bun_jsc::debugger::DebuggerId;
    /// `jsc.API.JSBundler.Plugin` — opaque FFI handle (JSBundlerPlugin__create).
    pub type Plugin = core::ffi::c_void;
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

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mode {
    Development,
    ProductionDynamic,
    ProductionStatic,
}

/// `bake.Framework.ServerComponents`.
#[derive(Clone)]
pub struct ServerComponents {
    pub separate_ssr_graph: bool,
    pub server_runtime_import: &'static [u8],
    pub server_register_client_reference: &'static [u8],
    pub server_register_server_reference: &'static [u8],
    pub client_register_server_reference: &'static [u8],
}
impl Default for ServerComponents {
    fn default() -> Self {
        Self {
            separate_ssr_graph: false,
            server_runtime_import: b"",
            server_register_client_reference: b"registerClientReference",
            server_register_server_reference: b"registerServerReference",
            client_register_server_reference: b"registerServerReference",
        }
    }
}

#[derive(Clone)]
pub struct ReactFastRefresh {
    pub import_source: &'static [u8],
}
impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self { import_source: b"react-refresh/runtime" }
    }
}

/// `bake.Framework.FileSystemRouterType`. Full body (with `Style` enum and
/// `from_js`) lives in the gated `bake_body.rs` draft; only the field set
/// DevServer touches is named here.
#[derive(Clone)]
pub struct FileSystemRouterType {
    pub root: &'static [u8],
    pub prefix: &'static [u8],
    pub entry_client: Option<&'static [u8]>,
    pub entry_server: Option<&'static [u8]>,
    pub ignore_underscores: bool,
    pub ignore_dirs: &'static [&'static [u8]],
    pub extensions: &'static [&'static [u8]],
    pub style: framework_router::Style,
    pub allow_layouts: bool,
}

/// A "Framework" is simply a set of bundler options that a framework author
/// would set in order to integrate with the application. Since many fields
/// have default values which may point to static memory, this structure is
/// always arena-allocated, usually owned by the arena in `UserOptions`.
pub struct Framework {
    pub is_built_in_react: bool,
    /// PORT NOTE: arena-owned in Zig (`options.arena`). `'static` is a
    /// placeholder for the arena lifetime; see LIFETIMES.tsv.
    // TODO(port): thread `'arena` lifetime once `UserOptions<'arena>` is real.
    pub file_system_router_types: &'static [FileSystemRouterType],
    pub server_components: Option<ServerComponents>,
    pub react_fast_refresh: Option<ReactFastRefresh>,
    pub built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
}
impl Default for Framework {
    fn default() -> Self {
        Self {
            is_built_in_react: false,
            file_system_router_types: &[],
            server_components: None,
            react_fast_refresh: None,
            built_in_modules: bun_collections::StringArrayHashMap::new(),
        }
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
pub struct HmrRuntime {
    pub code: &'static [u8],
    pub line_count: u32,
}

/// `bake.UserOptions` — top-level JS-facing options struct. Full body (with
/// `from_js`) gated in `bake_body.rs`; only the type identity is needed by
/// `server/ServerConfig.rs`.
pub struct UserOptions(());
pub struct StringRefList(());

// ══════════════════════════════════════════════════════════════════════════
// FrameworkRouter
// ══════════════════════════════════════════════════════════════════════════
pub mod framework_router {
    use bun_collections::{ArrayHashMap, StringArrayHashMap};

    /// Metadata for route files is specified out of line: in DevServer it is an
    /// `IncrementalGraph(.server).FileIndex`; in production build it is an
    /// entrypoint index.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
    pub struct OpaqueFileId(pub u32);
    impl OpaqueFileId {
        #[inline] pub const fn init(v: u32) -> Self { Self(v) }
        #[inline] pub const fn get(self) -> u32 { self.0 }
    }
    // TODO(port): `bun.GenericIndex.Optional` is a packed sentinel
    // (`maxInt = none`); `Option<T>` changes layout. Fine for non-FFI fields.
    pub type OpaqueFileIdOptional = Option<OpaqueFileId>;

    /// `FrameworkRouter.Route.Index` — `bun.GenericIndex(u31, Route)`.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
    pub struct RouteIndex(pub u32);
    impl RouteIndex {
        #[inline] pub const fn init(v: u32) -> Self { Self(v) }
        #[inline] pub const fn get(self) -> u32 { self.0 }
    }

    /// `FrameworkRouter.Type.Index` — `enum(u8) { _ }`.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
    pub struct TypeIndex(pub u8);

    /// `FrameworkRouter.Style` — routing convention (`.nextjs-pages` etc).
    /// Full enum body in gated `FrameworkRouter.rs`; variants named for
    /// `FileSystemRouterType.style` field.
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Style {
        NextjsPages,
        NextjsAppUi,
        // TODO(b2-blocked): JavaScriptDefined(jsc::Strong) — needs bun_jsc.
    }

    /// `FrameworkRouter.Route.FileKind`.
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum FileKind {
        Page,
        Layout,
    }

    /// `FrameworkRouter.Route` — one node in the route tree. Full body (with
    /// `Part`, matching, deinit) gated in `FrameworkRouter.rs`.
    pub struct Route {
        pub parent: Option<RouteIndex>,
        pub first_child: Option<RouteIndex>,
        pub next_sibling: Option<RouteIndex>,
        pub r#type: TypeIndex,
        pub file_page: OpaqueFileIdOptional,
        pub file_layout: OpaqueFileIdOptional,
        pub bundle: super::dev_server::route_bundle::IndexOptional,
        // TODO(b2-blocked): `part: Part` (encoded path segment) — gated draft.
        _opaque_tail: (),
    }

    /// `FrameworkRouter.Type` — per-`FileSystemRouterType` resolved config.
    pub struct Type {
        pub abs_root: Box<[u8]>,
        pub prefix: Box<[u8]>,
        pub ignore_underscores: bool,
        pub ignore_dirs: Box<[Box<[u8]>]>,
        pub extensions: Box<[Box<[u8]>]>,
        pub style: Style,
        pub allow_layouts: bool,
        pub client_file: OpaqueFileIdOptional,
        pub server_file: OpaqueFileIdOptional,
        pub server_file_string: super::jsc::StrongOptional,
    }

    /// `FrameworkRouter.MatchedParams`.
    #[derive(Default)]
    pub struct MatchedParams {
        // TODO(b2-blocked): `BoundedArray<Param, 16>` — gated draft.
        _opaque: (),
    }

    pub type StaticRouteMap = StringArrayHashMap<RouteIndex>;
    pub type DynamicRouteMap = ArrayHashMap<Box<[u8]>, RouteIndex>;

    /// Discovers routes from the filesystem; see `FrameworkRouter.zig`.
    pub struct FrameworkRouter {
        pub root: Box<[u8]>,
        pub types: Box<[Type]>,
        pub routes: Vec<Route>,
        pub static_routes: StaticRouteMap,
        pub dynamic_routes: DynamicRouteMap,
        /// Arena for pattern strings (`EncodedPattern`/`StaticRoute.route_path`).
        pub pattern_arena: bun_alloc::Arena,
    }
    impl FrameworkRouter {
        // TODO(b2-blocked): `init_empty` (FrameworkRouter.zig:96) — needs
        // `Resolver` walk; un-gate from `FrameworkRouter.rs` once
        // `bun_resolver::DirInfo` is real.
    }

    /// `FrameworkRouter.InsertionContext` — manual vtable (Zig used
    /// `*anyopaque` + comptime fn-ptr table; already indirect).
    pub struct InsertionContext {
        pub opaque_ctx: *mut (),
        pub vtable: &'static InsertionVTable,
    }
    pub struct InsertionVTable {
        pub get_file_id_for_router:
            fn(*mut (), &[u8], RouteIndex, FileKind) -> Result<OpaqueFileId, bun_alloc::AllocError>,
        pub on_router_syntax_error: fn(*mut (), &[u8], TinyLog) -> Result<(), bun_alloc::AllocError>,
        pub on_router_collision_error:
            fn(*mut (), &[u8], OpaqueFileId, FileKind) -> Result<(), bun_alloc::AllocError>,
    }
    /// `FrameworkRouter.TinyLog` — small fixed-buffer log for parse errors.
    #[derive(Default)]
    pub struct TinyLog(());
}
pub use framework_router as FrameworkRouter;

// ══════════════════════════════════════════════════════════════════════════
// production
// ══════════════════════════════════════════════════════════════════════════
pub mod production {
    /// Data used on each rendering thread. Referred to as `pt` in field
    /// naming, and `Bake::ProductionPerThread` in C++.
    ///
    /// Full struct (lifetime-parameterized, with `bundled_outputs`/`source_maps`
    /// fields) lives in the gated `production.rs` draft and depends on
    /// `bun_jsc::Strong` + `bun_bundler::OutputFile::Index`.
    // TODO(b2-blocked): bun_jsc::Strong — un-gate full PerThread<'a>.
    pub struct PerThread(());
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
