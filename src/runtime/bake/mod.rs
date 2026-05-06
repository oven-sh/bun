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
    // The two nominal type sets diverged and forced `todo!()` shims. The body
    // module is now fully ported and un-gated, so re-export everything so
    // `framework_router::X` ≡ `framework_router_body::X` and the real method
    // bodies (`init_empty`, `match_slow`, `memory_cost`, `to_js`, …) resolve
    // directly.
    pub use super::framework_router_body::{
        DynamicRouteMap, EncodedPattern, FileKind, FrameworkRouter, InsertionHandler,
        JSFrameworkRouter, MatchedParams, OpaqueFileId, OpaqueFileIdOptional, Part, Route,
        RouteIndex, StaticRouteMap, Style, TinyLog, Type, TypeIndex,
    };

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
    pub use super::production_body::build_command;

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
