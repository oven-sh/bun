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
#[derive(Clone)]
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
    /// Spec bake.zig:841 is `[:0]const u8` — NUL-terminated; the sentinel is
    /// load-bearing where this buffer is handed to JSC/C++ as a C string.
    pub code: &'static bun_str::ZStr,
    pub line_count: u32,
}

// `bake.UserOptions` — top-level JS-facing options struct. Full body (with
// `from_js`) lives in the un-gated `bake_body.rs` draft and is re-exported
// above; the keystone `(())` stub is gone now that `bake_body` compiles.
pub use bake_body::StringRefList;

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
        NextjsAppRoutes,
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
        pub prev_sibling: Option<RouteIndex>,
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
        /// Spec FrameworkRouter.zig:112 — NON-optional (every router type has
        /// a server entrypoint). Only `client_file` is `.Optional`.
        pub server_file: OpaqueFileId,
        pub server_file_string: super::jsc::StrongOptional,
    }

    /// `FrameworkRouter.MatchedParams`.
    #[derive(Default)]
    pub struct MatchedParams {
        // TODO(b2-blocked): `BoundedArray<Param, 16>` — gated draft.
        _opaque: (),
    }

    /// `FrameworkRouter.EncodedPattern` — a route pattern with dynamic
    /// segments encoded so that `/hello/[foo]/bar` and `/hello/[baz]/bar`
    /// hash/compare *equal* (FrameworkRouter.zig:19-27). Keying
    /// `DynamicRouteMap` on raw bytes would let those two patterns coexist,
    /// silently passing routes the spec rejects as duplicates.
    #[derive(Clone, Debug)]
    pub struct EncodedPattern(pub Box<[u8]>);
    impl core::hash::Hash for EncodedPattern {
        fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
            // Spec: `EffectiveURLContext` (FrameworkRouter.zig:19-27) hashes the
            // pattern with dynamic-segment *names* erased so `[foo]` ≡ `[bar]`.
            // TODO(port): full segment-erasure body lives in the gated
            // `FrameworkRouter.rs::EffectiveUrlContext`; un-gate once
            // `Part::decode` is available here.
            self.0.hash(state)
        }
    }
    impl PartialEq for EncodedPattern {
        fn eq(&self, other: &Self) -> bool {
            // TODO(port): must match `EffectiveURLContext.eql` — compares by
            // effective URL (dynamic segment names ignored). See gated
            // `FrameworkRouter.rs::EffectiveUrlContext`.
            self.0 == other.0
        }
    }
    impl Eq for EncodedPattern {}

    pub type StaticRouteMap = StringArrayHashMap<RouteIndex>;
    pub type DynamicRouteMap = ArrayHashMap<EncodedPattern, RouteIndex>;

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

    // ── re-exports from the full FrameworkRouter.rs draft ───────────────
    // production.rs needs `Part`, `init_empty`, `scan_all`, `route_ptr`,
    // `InsertionHandler`; surface them here so callers go through the
    // canonical `crate::bake::framework_router` path.
    pub use super::framework_router_body::{InsertionHandler, Part};

    impl InsertionContext {
        /// Zig: `InsertionContext.wrap(T, ptr)` — comptime vtable generation.
        /// Port: thin shim over the trait-object form (`&mut dyn InsertionHandler`).
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
