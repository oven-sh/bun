// ══════════════════════════════════════════════════════════════════════════
// B-2 un-gated header — real `BundleV2` struct definition.
// resolver↔bundler cycle broken in O; `bun_resolver` is now a direct dep, so
// `Transpiler` (which embeds `Resolver`) is referenceable here. Method bodies
// remain in the gated `bv2_impl` module below until `LinkerContext`,
// `ParseTask`, `ThreadPool`, and the JSBundler/api TYPE_ONLY split land.
// ══════════════════════════════════════════════════════════════════════════

use crate::mal_prelude::*;
use core::ptr::NonNull;

use bun_collections::{ArrayHashMap, StringHashMap, VecExt};
use bun_core::ThreadLock;

// `bake_types` / `dispatch` are canonically defined in `bv2_impl` below
// (the full versions); re-exported here so the crate-root `lib.rs` modules and
// the outer `BundleV2` struct see exactly the same types as the impl bodies.
pub use bv2_impl::api;
pub use bv2_impl::bake_types;
pub use bv2_impl::dispatch;
pub use bv2_impl::{DevServerInput, DevServerOutput, ImportTrackerIterator, ImportTrackerStatus};
// DEDUP(D059): the value-type set below is canonically defined in
// `crate::ungate_support` (lib.rs:15 glob-re-exports it at the crate root). The
// `bv2_impl` draft body previously carried duplicate definitions that no caller
// reached; re-export the canonical ones here to preserve `bundle_v2::Foo`
// spellings for external callers.
pub use crate::ungate_support::entry_point::{
    EntryPoint, Kind as EntryPointKind, List as EntryPointList,
};
pub use crate::ungate_support::{
    ExportData, ImportData, ImportTracker, JSMeta, generic_path_with_pretty_initialized,
};
// Flatten the impl-body module into this file's namespace so external callers
// (`bun_runtime::cli::*`, `linker_context::*`) reference items as
// `bundle_v2::Foo` rather than naming the implementation submodule.
use self::bake_types as bake;
pub use crate::ungate_support::RefImportData;
pub use bv2_impl::{
    BuildResult, BundleV2Result, CompletionStruct, CrossChunkImport, DependenciesScanner,
    DependenciesScannerResult, EXTERNAL_FREE_VTABLE, OnDependenciesAnalyze, singleton,
};

pub use crate::DeferredBatchTask::DeferredBatchTask;
use crate::Graph::{Graph, InputFileColumns};
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::barrel_imports::{self, RequestedExports};
use crate::cache::ExternalFreeFunction;
use crate::options::{self, Target};
use crate::parse_task::{self, ResultValue as ParseResultValue};
use crate::transpiler::Transpiler;
use crate::ungate_support::{EventLoop, UseDirective};
use crate::{Index, IndexInt, LinkerContext};
use bun_ast::SideEffects;

// ── re-exports for the B-1 inline `pub mod bundle_v2 { … }` shim surface ──
/// `BundleThread` (BundleThread.zig) — owns the worker pool + completion
/// queue for `BundleV2`. Re-exported so callers reference `bundle_v2::BundleThread`.
pub use crate::BundleThread::BundleThread;
pub use crate::ParseTask;
pub(crate) use bun_ast::Loader;

/// `jsc::api::JSBundler::Plugin` — re-exported from the canonical def below.
pub use api::JSBundler::Plugin as JSBundlerPlugin;

/// `BundleV2.JSBundleCompletionTask` — re-exported from the canonical def below.
pub use bv2_impl::JSBundleCompletionTask;

/// `jsc::api::JSBundler::FileMap` — re-exported from the canonical def below.
pub use api::JSBundler::FileMap;

#[derive(Clone, Copy)]
pub struct PendingImport {
    pub to_source_index: Index,
    pub import_record_index: u32,
}

pub struct BundleV2<'a> {
    // PORT NOTE: Zig stored `*Transpiler` (and aliased the same pointer into
    // `ssr_transpiler` when SSR graph isn't separate). `ssr_transpiler` stays
    // `*mut` so the alias is legal; `transpiler` is `&'a mut` for ergonomic
    // field access throughout the bundler bodies.
    pub transpiler: &'a mut Transpiler<'a>,
    /// When Server Components is enabled, this is used for the client bundles
    /// and `transpiler` is used for the server bundles.
    ///
    /// `ParentRef` (not raw `NonNull`): set once in `init` (from `BakeOptions`
    /// or `initialize_client_transpiler`), the pointee is live for `'a`, and
    /// the read-only projection (`client_transpiler_ref`) is the common path —
    /// so the safe `Deref` removes the per-accessor `unsafe { p.as_ref() }`.
    /// The two `&mut` sites in `transpiler_for_target` go through the explicit
    /// `unsafe assume_mut` escape hatch.
    pub client_transpiler: Option<bun_ptr::ParentRef<Transpiler<'a>>>,
    /// Owns the storage backing `client_transpiler` when it was lazily created
    /// by `initialize_client_transpiler` (browser-target request from a
    /// server-side build). Stays `None` when `client_transpiler` is borrowed
    /// from `BakeOptions` (DevServer owns that one). Dropped in
    /// `deinit_without_freeing_arena` so the deep-cloned `BundleOptions` /
    /// `Resolver` global-heap fields are released — `arena.alloc` would leak
    /// them since bumpalo never runs `Drop`.
    pub owned_client_transpiler: Option<Box<Transpiler<'a>>>,
    /// See `bake.Framework.ServerComponents.separate_ssr_graph`.
    pub ssr_transpiler: *mut Transpiler<'a>,
    /// When Bun Bake is used, the resolved framework is passed here.
    pub framework: Option<bake::Framework>,
    pub graph: Graph,
    // Real `LinkerContext<'a>` (un-gated B-2). Borrows the same arena lifetime
    // as `transpiler` (Zig stored both as raw pointers into the bundler heap).
    pub linker: LinkerContext<'a>,
    // The hot reloader (`jsc::hot_reloader::NewHotReloader<BundleV2, …>`) owns the
    // boxed `Watcher`; bundler only ever calls `Watcher::add_file` on it.
    pub bun_watcher: Option<NonNull<bun_watcher::Watcher>>,
    pub plugins: Option<NonNull<JSBundlerPlugin>>,
    pub completion: Option<dispatch::CompletionHandle>,
    /// CYCLEBREAK GENUINE: erased `bake::DevServer` (see `dispatch::DevServerHandle`).
    /// Populated from `transpiler.options.dev_server` + the runtime-registered vtable at
    /// construction. All ~15 DevServer call sites go through this.
    pub dev_server: Option<dispatch::DevServerHandle>,
    /// In-memory files that can be used as entrypoints or imported.
    /// This is a pointer to the FileMap in the completion config.
    pub file_map: Option<&'a FileMap>,
    pub source_code_length: usize,

    /// There is a race condition where an onResolve plugin may schedule a task
    /// on the bundle thread before its parsing task completes.
    pub resolve_tasks_waiting_for_import_source_index: ArrayHashMap<IndexInt, Vec<PendingImport>>,

    /// Allocations not tracked by a threadlocal heap.
    pub free_list: Vec<Box<[u8]>>,

    /// See the comment in `Chunk.OutputPiece`.
    pub unique_key: u64,
    pub dynamic_import_entry_points: ArrayHashMap<IndexInt, ()>,
    pub has_on_parse_plugins: bool,

    pub finalizers: Vec<ExternalFreeFunction>,

    pub drain_defer_task: DeferredBatchTask,

    /// Set true by DevServer. Currently every usage of the transpiler (Bun.build
    /// and `bun build` CLI) runs at the top of an event loop. When this is true,
    /// a callback is executed after all work is complete (`finishFromBakeDevServer`).
    pub asynchronous: bool,
    pub thread_lock: ThreadLock,

    /// If false we can skip TLA validation and propagation.
    pub has_any_top_level_await_modules: bool,

    /// Barrel optimization: tracks which exports have been requested from each
    /// module encountered during barrel BFS. Keys are source indices. Values
    /// track requested export names for deduplication and cycle detection.
    /// Persists across calls to `scheduleBarrelDeferredImports` so cross-file
    /// deduplication is free.
    pub requested_exports: ArrayHashMap<u32, RequestedExports>,
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gated impl: lifecycle entry points (`init` skeleton, scan-counter
// machinery, `on_parse_task_complete`, `deinit_without_freeing_arena`). Method
// bodies are real where lower-tier surfaces exist; sub-regions that touch
// still-gated modules (`ThreadPool`, full `dispatch::DevServerVTable`,
// `ServerComponentParseTask`, `Watcher`) are ``-gated inline so
// the call shape is preserved verbatim and un-gates by deletion once those
// land. See `bv2_impl` below for the full reference bodies.
// ──────────────────────────────────────────────────────────────────────────

bun_core::declare_scope!(Bundle, visible);
bun_core::declare_scope!(scan_counter, visible);

/// `bundle_v2.zig` `ResolveQueue = std.StringArrayHashMap(*ParseTask)`.
/// Values are raw `*mut ParseTask` (arena-owned by `graph.heap`); the map only
/// dedups by path during a single `on_parse_task_complete` pass.
pub type ResolveQueue = StringHashMap<*mut ParseTask>;

/// `bundle_v2.zig:BakeOptions`.
pub struct BakeOptions<'a> {
    pub framework: bake::Framework,
    pub client_transpiler: NonNull<Transpiler<'a>>,
    pub ssr_transpiler: NonNull<Transpiler<'a>>,
    pub plugins: Option<NonNull<JSBundlerPlugin>>,
}

impl<'a> BundleV2<'a> {
    // ── raw-ptr accessors ─────────────────────────────────────────────────
    // PORT NOTE: `transpiler`/`ssr_transpiler` are `*mut` because Zig stored
    // aliased `*Transpiler` (same pointer in both slots when no SSR graph).
    // Callers go through these accessors so the unsafe deref is centralized.
    #[inline]
    pub fn transpiler(&self) -> &Transpiler<'a> {
        &*self.transpiler
    }
    #[inline]
    pub fn transpiler_mut(&mut self) -> &mut Transpiler<'a> {
        &mut *self.transpiler
    }

    #[inline]
    pub fn r#loop(&mut self) -> &mut EventLoop {
        &mut self.linker.r#loop
    }

    /// `switch (this.loop().*)` — `linker.loop` is a non-owning backref to the
    /// `AnyEventLoop` that owns this bundle pass and outlives it.
    #[inline]
    pub fn any_loop_mut(&mut self) -> &mut bun_event_loop::AnyEventLoop<'static> {
        // BACKREF deref centralised in `LinkerContext::any_loop_mut`.
        self.linker
            .any_loop_mut()
            .expect("BundleV2.linker.loop must be set before plugins run")
    }

    #[inline]
    pub fn dev_server_handle(&self) -> Option<&dispatch::DevServerHandle> {
        self.dev_server.as_ref()
    }

    /// Safe projection of the `client_transpiler` backref. Set once in `init`
    /// (from `BakeOptions` or `initialize_client_transpiler`); the pointee is
    /// live for `'a`.
    #[inline]
    pub fn client_transpiler_ref(&self) -> Option<&Transpiler<'a>> {
        self.client_transpiler.as_deref()
    }

    /// Safe projection of the `plugins` backref (opaque C++ `BunPlugin`).
    /// Set once in `init` from `BakeOptions` / completion config; live for the
    /// bundle pass.
    #[inline]
    pub fn plugins_ref(&self) -> Option<&JSBundlerPlugin> {
        // SAFETY: BACKREF — opaque C++ object owned by the completion task /
        // bake DevServer, outlives the bundle pass. All `&self` methods on it
        // are FFI calls that take `*const`.
        self.plugins.map(|p| unsafe { p.as_ref() })
    }

    /// Mutable projection of the `plugins` backref for FFI calls that take
    /// `*mut` (`drain_deferred`). The pointee is disjoint from `self` storage.
    #[inline]
    pub fn plugins_mut(&mut self) -> Option<&mut JSBundlerPlugin> {
        // SAFETY: BACKREF — see `plugins_ref`. `&mut self` ensures no other
        // `&JSBundlerPlugin` projection from this `BundleV2` overlaps.
        self.plugins.map(|mut p| unsafe { p.as_mut() })
    }

    /// Mutable projection of the `bun_watcher` backref for `Watcher::add_file`.
    /// Centralises the two open-coded `unsafe { ptr.as_mut() }` sites so the
    /// liveness/exclusivity argument lives in one place.
    #[inline]
    pub fn bun_watcher_mut(&mut self) -> Option<&mut bun_watcher::Watcher> {
        // SAFETY: BACKREF — heap-owned by hot_reloader / DevServer (set via
        // `install_bun_watcher`), live for the process under `--watch`. The
        // watcher storage is disjoint from `self`; `&mut self` excludes any
        // other safe projection from this `BundleV2`, and `add_file` is only
        // ever driven from the single bundle thread (`thread_lock`-asserted).
        self.bun_watcher.map(|mut p| unsafe { p.as_mut() })
    }

    #[inline]
    pub fn path_to_source_index_map(
        &mut self,
        target: options::Target,
    ) -> &mut PathToSourceIndexMap {
        self.graph.path_to_source_index_map(target)
    }

    pub fn transpiler_for_target(&mut self, target: options::Target) -> &mut Transpiler<'a> {
        // SAFETY: all three pointers are live for `'a` (set in `init`); the
        // `client_transpiler` arm is only reached when bake populated it.
        // bundle_v2.zig:247-263 — outside of server-components / dev-server,
        // the only case that doesn't return the main transpiler is a
        // browser-target request from a server-side build, which lazily
        // spins up a client transpiler.
        if !self.transpiler.options.server_components && self.linker.dev_server.is_none() {
            if target == Target::Browser && self.transpiler.options.target.is_server_side() {
                if let Some(p) = self.client_transpiler {
                    // SAFETY: client_transpiler is live for `'a` (set in `init`);
                    // pointer carries write provenance (constructed from `&mut`
                    // / `NonNull::from(&mut _)`), and `&mut self` excludes any
                    // overlapping `client_transpiler_ref()` borrow.
                    return unsafe { p.assume_mut() };
                }
                // bundle_v2.zig:250-252 — `client_transpiler orelse initializeClientTranspiler() catch panic`.
                return self.initialize_client_transpiler().unwrap_or_else(|e| {
                    panic!("Failed to initialize client transpiler: {}", e.name())
                });
            }
            return &mut *self.transpiler;
        }
        // SAFETY: all three pointers are live for `'a` (set in `init`); the
        // `client_transpiler` arm is only reached when bake populated it.
        unsafe {
            match target {
                Target::Browser => self.client_transpiler.unwrap().assume_mut(),
                Target::BakeServerComponentsSsr => &mut *self.ssr_transpiler,
                _ => &mut *self.transpiler,
            }
        }
    }

    // PORT NOTE: draft `on_parse_task_complete` / `deinit_without_freeing_arena`
    // removed — canonical bodies live in the later impl blocks below.
}
// ══════════════════════════════════════════════════════════════════════════
// Phase-A draft body — gated until lower-tier crate surfaces solidify.
// (`bun_fs`/`bun_str`/`bun_node_fallbacks` crate aliases, full `dispatch`
// vtable slot set, `api::JSBundler` TYPE_ONLY split, `LinkerContext`,
// `ParseTask`, `ThreadPool`, OUT_DIR codegen for HmrRuntime embeds.)
// ══════════════════════════════════════════════════════════════════════════

pub mod bv2_impl {
    use super::ResolveQueue;
    use crate::IndexInt;
    use crate::mal_prelude::*;
    // This is Bun's JavaScript/TypeScript bundler
    //
    // A lot of the implementation is based on the Go implementation of esbuild. Thank you Evan Wallace.
    //
    // # Memory management
    //
    // Zig is not a managed language, so we have to be careful about memory management.
    // Manually freeing memory is error-prone and tedious, but garbage collection
    // is slow and reference counting incurs a performance penalty.
    //
    // Bun's bundler relies on mimalloc's threadlocal heaps as arena allocators.
    //
    // When a new thread is spawned for a bundling job, it is given a threadlocal
    // heap and all allocations are done on that heap. When the job is done, the
    // threadlocal heap is destroyed and all memory is freed.
    //
    // There are a few careful gotchas to keep in mind:
    //
    // - A threadlocal heap cannot allocate memory on a different thread than the one that
    //   created it. You will get a segfault if you try to do that.
    //
    // - Since the heaps are destroyed at the end of bundling, any globally shared
    //   references to data must NOT be allocated on a threadlocal heap.
    //
    //   For example, package.json and tsconfig.json read from the filesystem must be
    //   use the global arena (bun.default_allocator) because bun's directory
    //   entry cache and module resolution cache are globally shared across all
    //   threads.
    //
    //   Additionally, `LinkerContext`'s arena is also threadlocal.
    //
    // - Globally allocated data must be in a cache & reused, or we will create an infinite
    //   memory leak over time. To do that, we have a DirnameStore, FilenameStore, and the other
    //   data structures related to `BSSMap`. This still leaks memory, but not very
    //   much since it only allocates the first time around.
    //
    // In development, it is strongly recommended to use either a debug build of
    // mimalloc or Valgrind to help catch memory issues
    // To use a debug build of mimalloc:
    //
    //     make mimalloc-debug
    //

    use core::ffi::c_void;
    use core::ptr::NonNull;
    use std::io::Write as _;

    use crate::Graph::InputFileColumns;
    use crate::Index;
    use crate::options_impl::{LoaderExt, TargetExt};
    use crate::transpiler::Transpiler;
    use crate::ungate_support::JSAst;
    use crate::ungate_support::bun_fs as Fs;
    use crate::ungate_support::bun_node_fallbacks as NodeFallbackModules;
    use crate::ungate_support::{bun_css, bun_fs, import_record};
    use bun_alloc::{AllocError, Arena as ThreadLocalArena};
    use bun_ast::ServerComponentBoundary;
    use bun_ast::server_component_boundary;
    use bun_ast::{
        self as js_ast, B, Binding, Dependency, E, Expr, G, Part, Ref, S, Scope, Stmt, Symbol,
    };
    use bun_ast::{ImportKind, ImportRecord};
    use bun_collections::{
        ArrayHashMap, DynamicBitSet, DynamicBitSetUnmanaged, MultiArrayList, StringArrayHashMap,
        StringHashMap, VecExt,
    };
    use bun_core::strings;
    use bun_core::{self as bun, Environment, Error, FeatureFlags, Output};
    use bun_resolver::DataURL;
    use bun_resolver::fs::PathResolverExt as _;
    use bun_resolver::{self as _resolver, Resolver, is_package_path};
    use bun_threading::ThreadPool as ThreadPoolLib;
    // TODO(b0): bake_types arrives from move-in (TYPE_ONLY Side/Graph/BuiltInModule/Framework → bundler)
    use self::bake_types as bake;

    /// CYCLEBREAK(b0) TYPE_ONLY: pure value types from bake that bundler needs without
    /// depending on the full DevServer. Move-in pass keeps these as the canonical defs;
    /// bun_bake (post tier-6 collapse: bun_runtime::bake) re-exports from here.
    pub mod bake_types {
        /// Mirrors src/bake/lib.zig `Side`.
        #[repr(u8)]
        #[derive(Copy, Clone, Eq, PartialEq, Debug, core::marker::ConstParamTy)]
        pub enum Side {
            Client = 0,
            Server = 1,
        }
        /// Mirrors src/bake/lib.zig `Graph`.
        #[repr(u8)]
        #[derive(Copy, Clone, Eq, PartialEq, Debug)]
        pub enum Graph {
            Client = 0,
            Server = 1,
            Ssr = 2,
        }
        /// Zig `@tagName(graph)` — used for the per-file `// path (target)` comment
        /// in postProcessJSChunk and friends.
        impl From<Graph> for &'static str {
            fn from(g: Graph) -> Self {
                match g {
                    Graph::Client => "client",
                    Graph::Server => "server",
                    Graph::Ssr => "ssr",
                }
            }
        }
        impl Side {
            pub fn graph(self) -> Graph {
                match self {
                    Side::Client => Graph::Client,
                    Side::Server => Graph::Server,
                }
            }
        }
        /// Mirrors src/bake/DevServer.zig `FileKind` (the type of `CacheEntry.kind`).
        #[repr(u8)]
        #[derive(Copy, Clone, Eq, PartialEq, Debug)]
        pub enum CacheKind {
            Unknown = 0,
            Js = 1,
            Asset = 2,
            Css = 3,
        }
        #[derive(Copy, Clone)]
        pub struct CacheEntry {
            pub kind: CacheKind,
        }
        /// Mirrors src/bake/DevServer.zig `ASSET_PREFIX` (= INTERNAL_PREFIX ++ "/asset" = "/_bun/asset").
        pub const ASSET_PREFIX: &str = "/_bun/asset";

        /// Mirrors src/bake/bake.zig:355 `BuiltInModule = union(enum)`. TYPE_ONLY moved
        /// down to bundler (T5); bake (in runtime, T6) constructs values of this type.
        pub enum BuiltInModule {
            Import(Box<[u8]>),
            Code(Box<[u8]>),
        }

        /// Mirrors src/bake/DevServer.zig `EntryPointList.Flags` (`packed struct(u8)`).
        #[repr(transparent)]
        #[derive(Copy, Clone, Default, Eq, PartialEq)]
        pub struct EntryPointFlags(pub u8);
        impl EntryPointFlags {
            pub const CLIENT: u8 = 1 << 0;
            pub const SERVER: u8 = 1 << 1;
            pub const SSR: u8 = 1 << 2;
            /// When set, `.CLIENT` is also set.
            pub const CSS: u8 = 1 << 3;
            #[inline]
            pub fn client(self) -> bool {
                self.0 & Self::CLIENT != 0
            }
            #[inline]
            pub fn server(self) -> bool {
                self.0 & Self::SERVER != 0
            }
            #[inline]
            pub fn ssr(self) -> bool {
                self.0 & Self::SSR != 0
            }
            #[inline]
            pub fn css(self) -> bool {
                self.0 & Self::CSS != 0
            }
        }

        /// Mirrors src/bake/DevServer.zig `EntryPointList`. TYPE_ONLY moved down; bundler
        /// reads `.set` (count/keys/values) in `enqueue_entry_points_dev_server`.
        #[derive(Default)]
        pub struct EntryPointList {
            pub set: bun_collections::StringArrayHashMap<EntryPointFlags>,
        }
        impl EntryPointList {
            pub fn empty() -> Self {
                Self {
                    set: bun_collections::StringArrayHashMap::new(),
                }
            }
        }

        /// Mirrors src/bake/bake.zig `Framework`. TYPE_ONLY subset of the fields
        /// the bundler/parser actually consult (see ParseTask.zig:1253
        /// `opts.framework = transpiler.options.framework`); `file_system_router_types`
        /// stays in T6 because only `bake::FrameworkRouter` reads it.
        pub struct Framework {
            pub built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
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
            /// In Zig this lives on the legacy package_json `Framework`; the duck-typed
            /// `comptime TranspilerType` callers reach it through `options.framework.?`.
            pub client_css_in_js: crate::options::ClientCssInJs,
            // TODO(b0-genuine): remaining Framework field `file_system_router_types`
            // stays in T6; only bake::FrameworkRouter reads it.
            _opaque_tail: (),
        }
        impl Framework {
            /// Construct the bundler-side TYPE_ONLY view. Called from
            /// `bun_runtime::bake::Framework::init_transpiler_with_options`
            /// (spec bake.zig:778 `out.options.framework = framework`); the
            /// runtime owns the canonical `bake.Framework` and projects the
            /// fields the bundler reads.
            pub fn new(
                built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
                server_components: Option<ServerComponents>,
                react_fast_refresh: Option<ReactFastRefresh>,
                is_built_in_react: bool,
            ) -> Self {
                Self {
                    built_in_modules,
                    server_components,
                    react_fast_refresh,
                    is_built_in_react,
                    client_css_in_js: crate::options::ClientCssInJs::default(),
                    _opaque_tail: (),
                }
            }
        }
        /// Mirrors src/bake/bake.zig `Framework.ServerComponents` — full string
        /// surface so the parser-side projection (ParseTask.rs `run_with_source_code`)
        /// can forward user-configured `serverRegisterServerReference` /
        /// `clientRegisterServerReference` instead of hardcoding defaults.
        #[derive(Default, Clone)]
        pub struct ServerComponents {
            pub separate_ssr_graph: bool,
            pub server_runtime_import: Box<[u8]>,
            pub server_register_client_reference: Box<[u8]>,
            pub server_register_server_reference: Box<[u8]>,
            pub client_register_server_reference: Box<[u8]>,
        }
        /// Mirrors src/bake/bake.zig `Framework.ReactFastRefresh`.
        #[derive(Clone)]
        pub struct ReactFastRefresh {
            pub import_source: Box<[u8]>,
        }

        /// Mirrors src/bake/bake.zig:840 `HmrRuntime`. TYPE_ONLY moved down so the
        /// linker can splice the runtime preamble without depending on bun_bake.
        #[derive(Clone, Copy)]
        pub struct HmrRuntime {
            pub code: &'static [u8],
            /// Precomputed `\n` count — sourcemap generation skips this many lines.
            pub line_count: u32,
        }
        impl HmrRuntime {
            pub const fn init(code: &'static [u8]) -> Self {
                // const-fn line counter (mirrors `std.mem.count(u8, code, "\n")`).
                let mut n: u32 = 0;
                let mut i = 0usize;
                while i < code.len() {
                    if code[i] == b'\n' {
                        n += 1;
                    }
                    i += 1;
                }
                Self {
                    code,
                    line_count: n,
                }
            }
        }
        /// Alias used at the crate root (`crate::HmrRuntimeSide`); identical to `Side`.
        pub type HmrRuntimeSide = Side;

        /// Mirrors src/bake/bake.zig:855 `getHmrRuntime`. MOVE_DOWN bake→bundler:
        /// the codegen'd `bake.client.js` / `bake.server.js` are loaded via
        /// `bun_core::runtime_embed_file!` (same per-site `OnceLock<String>` cache
        /// `js_parser/runtime.rs` uses for `runtime.out.js`), so the storage lives
        /// HERE — no upward link to `bun_runtime`. `bun_runtime::bake` keeps its
        /// own `&'static ZStr` flavour for JSC/C++ handoff; this bundler-side copy
        /// only needs `&[u8]` for the chunk preamble + sourcemap line skip, so the
        /// NUL-termination dance is unnecessary. Per-side `OnceLock<HmrRuntime>`
        /// memoizes the `\n` count (Zig const-eval'd it on the `@embedFile` arm;
        /// `runtime_embed_file!` already caches the file load, this caches the
        /// `init` scan so repeat calls are a `Copy`).
        pub fn get_hmr_runtime(side: Side) -> HmrRuntime {
            static CLIENT: std::sync::OnceLock<HmrRuntime> = std::sync::OnceLock::new();
            static SERVER: std::sync::OnceLock<HmrRuntime> = std::sync::OnceLock::new();
            match side {
                Side::Client => *CLIENT.get_or_init(|| {
                    HmrRuntime::init(
                        bun_core::runtime_embed_file!(CodegenEager, "bake.client.js").as_bytes(),
                    )
                }),
                // Server runtime is loaded once; non-eager.
                Side::Server => *SERVER.get_or_init(|| {
                    HmrRuntime::init(
                        bun_core::runtime_embed_file!(Codegen, "bake.server.js").as_bytes(),
                    )
                }),
            }
        }

        /// Mirrors src/bake/bake.zig:936 `server_virtual_source` / :942 `client_virtual_source`.
        /// `bun_ast::Source` is not `const`-constructible (owns a `fs::Path`), so these
        /// are lazy statics. PERF(port): was `pub const` — verify in Phase B.
        pub static SERVER_VIRTUAL_SOURCE: std::sync::LazyLock<bun_ast::Source> =
            std::sync::LazyLock::new(|| {
                let mut s = bun_ast::Source::default();
                // Port of `Fs.Path.initForKitBuiltIn("bun", "bake/server")` (fs.zig:1992) —
                // inlined because `bun_paths::fs::Path<'static>` is the local TYPE_ONLY stub and
                // does not yet expose that constructor.
                s.path = bun_paths::fs::Path {
                    pretty: b"bun:bake/server",
                    text: b"_bun/bake/server",
                    namespace: b"bun",
                    name: bun_paths::fs::PathName::init(b"bake/server"),
                    is_disabled: false,
                    is_symlink: true,
                };
                s.index = bun_ast::Index(crate::Index::BAKE_SERVER_DATA.get());
                s
            });
        pub static CLIENT_VIRTUAL_SOURCE: std::sync::LazyLock<bun_ast::Source> =
            std::sync::LazyLock::new(|| {
                let mut s = bun_ast::Source::default();
                s.path = bun_paths::fs::Path {
                    pretty: b"bun:bake/client",
                    text: b"_bun/bake/client",
                    namespace: b"bun",
                    name: bun_paths::fs::PathName::init(b"bake/client"),
                    is_disabled: false,
                    is_symlink: true,
                };
                s.index = bun_ast::Index(crate::Index::BAKE_CLIENT_DATA.get());
                s
            });
        /// Alias kept for callers that referenced the DevServer constant name directly.
        pub const DEV_SERVER_ASSET_PREFIX: &str = ASSET_PREFIX;

        /// Canonical port of src/bake/production.zig:844 `EntryPointMap`.
        /// Lives in the bundler (lower tier) so both `bun_runtime::bake::production`
        /// and `BundleV2::generate_from_bake_production_cli` share ONE nominal type
        /// (PORTING.md §Layering). Router-integration methods (`InsertionHandler`)
        /// are added by `bun_runtime::bake` via a local trait impl.
        pub mod production {
            use super::Side;

            /// `OpaqueFileId` is the insertion index into `EntryPointMap.files`.
            /// This is the same newtype as `framework_router::OpaqueFileId`; the
            /// bake crate re-exports that one and converts via `.get()` only at
            /// the FFI boundary.
            #[repr(transparent)]
            #[derive(Copy, Clone, Eq, PartialEq, Hash)]
            pub struct OpaqueFileId(pub u32);
            impl OpaqueFileId {
                #[inline]
                pub const fn init(i: u32) -> Self {
                    Self(i)
                }
                #[inline]
                pub const fn get(self) -> u32 {
                    self.0
                }
            }

            /// `EntryPointMap.InputFile`. Zig packed `Side` into the slice-len word
            /// for a 16-byte key; the Rust `Hash`/`Eq` impls below are content-based
            /// (not byte-layout), so that packing is not load-bearing here — store a
            /// `RawSlice` instead and let `bun_ptr` encapsulate the unsafe re-borrow.
            /// `RawSlice<u8>: Send + Sync`, so no manual auto-trait impls are needed.
            #[derive(Copy, Clone)]
            pub struct InputFile {
                abs_path: bun_ptr::RawSlice<u8>,
                pub side: Side,
            }
            impl InputFile {
                #[inline]
                pub fn init(abs_path: &[u8], side: Side) -> Self {
                    Self {
                        abs_path: bun_ptr::RawSlice::new(abs_path),
                        side,
                    }
                }
                #[inline]
                pub fn abs_path(&self) -> &[u8] {
                    // Backing allocation is owned by `EntryPointMap.owned_paths`
                    // (duped on insert) and outlives every key stored in `files`.
                    self.abs_path.slice()
                }
            }
            impl core::hash::Hash for InputFile {
                fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
                    state.write(self.abs_path());
                    state.write_u8(self.side as u8);
                }
            }
            impl PartialEq for InputFile {
                fn eq(&self, other: &Self) -> bool {
                    self.side == other.side && self.abs_path() == other.abs_path()
                }
            }
            impl Eq for InputFile {}

            /// Value side is `OutputFile.Index` — left as a placeholder until the
            /// bundle is indexed (Zig leaves it `undefined`); the bundler never reads it.
            pub use crate::output_file::Index as OutputFileIndex;

            pub type EntryPointHashMap = bun_collections::ArrayHashMap<InputFile, OutputFileIndex>;

            #[derive(Default)]
            pub struct EntryPointMap {
                pub root: Box<[u8]>,
                /// `OpaqueFileId` is the insertion index into this map.
                pub files: EntryPointHashMap,
                /// Owned backing storage for the duped path bytes that `InputFile`
                /// keys point into (raw ptr+len). Mirrors Zig's `map.arena.dupe`
                /// against `bun.default_allocator` — kept here so the allocations
                /// drop with the map (PORTING.md §Forbidden: no `Box::leak`).
                pub owned_paths: Vec<Box<[u8]>>,
            }
            impl EntryPointMap {
                /// Mirrors `getOrPutEntryPoint`. Dupes `abs_path` on first insert
                /// (owned by `owned_paths`; `Box` heap address is stable across the
                /// move so the raw key pointer stays valid).
                pub fn get_or_put_entry_point(
                    &mut self,
                    abs_path: &[u8],
                    side: Side,
                ) -> Result<OpaqueFileId, bun_core::Error> {
                    let probe = InputFile::init(abs_path, side);
                    if let Some(index) = self.files.get_index(&probe) {
                        return Ok(OpaqueFileId::init(index as u32));
                    }
                    // Zig: `gop.key_ptr.* = InputFile.init(try map.arena.dupe(u8, abs_path), side);`
                    // The Zig `errdefer map.files.swapRemoveAt(gop.index)` only guards the
                    // `arena.dupe`, which is infallible in Rust, so no rollback needed.
                    let owned: Box<[u8]> = Box::<[u8]>::from(abs_path);
                    let key = InputFile::init(&owned, side);
                    self.owned_paths.push(owned);
                    let index = self.files.count();
                    // Value is the post-bundle output index; left as a placeholder until
                    // the bundle is indexed (production.zig:873 leaves it `undefined`).
                    self.files.put_no_clobber(key, OutputFileIndex::init(0))?;
                    Ok(OpaqueFileId::init(index as u32))
                }
            }
        }
    }
    // TODO(b0): jsc::api arrives from move-in (TYPE_ONLY → bundler)
    use self::api as jsc_api;

    /// CYCLEBREAK(b0) TYPE_ONLY: data-only halves of `jsc::api::JSBundler` and
    /// `jsc::api::BuildArtifact` that the bundler reads/constructs without touching
    /// JSC. The JS-thread halves (dispatch onto the JS event loop, `toJS`, plugin
    /// FFI bodies) stay in tier-6 (`bun_runtime::api`) and re-export these.
    pub mod api {
        /// Mirrors src/runtime/api/JSBundler.zig:1799 `BuildArtifact.OutputKind`.
        /// Canonical definition lives in `crate::options::OutputKind`; re-exported
        /// here so the documented CYCLEBREAK path `api::build_artifact::OutputKind`
        /// keeps resolving.
        pub mod build_artifact {
            pub use crate::options::OutputKind;
        }

        /// Mirrors src/runtime/api/JSBundler.zig:3 `JSBundler` — TYPE_ONLY subset.
        /// Exposed as a module (not a struct) so callers can write
        /// `api::JSBundler::Load` / `api::JSBundler::Resolve::MiniImportRecord`.
        #[allow(non_snake_case)]
        pub mod JSBundler {
            use super::super::BundleV2;
            use crate::options::{Loader, Target};
            use crate::options_impl::TargetExt;
            use crate::parse_task::ParseTask;
            use bun_ast::ImportKind;
            use bun_core::String as BunString;
            use bun_resolver::fs::PathResolverExt as _;

            /// `Plugin = opaque {}` — backed by C++ `BunPlugin`. The bundler calls
            /// `has_any_matches` / `match_on_load` / `match_on_resolve` directly
            /// (no JSC types needed — only `BunString` / raw context ptrs). The
            /// JSC-aware methods (`create`, `add_plugin`, `global_object`, …) are
            /// added by `bun_runtime` via the `PluginJscExt` extension trait so
            /// this crate stays free of `JSValue` / `JSGlobalObject`.
            bun_opaque::opaque_ffi! { pub struct Plugin; }
            unsafe extern "C" {
                // The three `safe fn`s below take only Rust references / by-value
                // scalars: every pointer the C++ side reads is guaranteed valid by
                // the type system, so there is no caller-side precondition left to
                // discharge (mirrors the `safe fn` pattern in `lolhtml_sys`).
                #[link_name = "JSBundlerPlugin__anyMatches"]
                safe fn JSBundlerPlugin__anyMatches(
                    this: &Plugin,
                    namespace: &BunString,
                    path: &BunString,
                    is_on_load: bool,
                ) -> bool;
                // `context` is an opaque cookie C++ round-trips back to a Rust
                // callback without dereferencing, so the only pointer validity
                // obligations are on `this`/`BunString` — discharged by `&`.
                #[link_name = "JSBundlerPlugin__matchOnLoad"]
                safe fn JSBundlerPlugin__matchOnLoad(
                    this: &mut Plugin,
                    namespace_string: &BunString,
                    path: &BunString,
                    context: *mut core::ffi::c_void,
                    default_loader: u8,
                    is_server_side: bool,
                );
                #[link_name = "JSBundlerPlugin__matchOnResolve"]
                safe fn JSBundlerPlugin__matchOnResolve(
                    this: &mut Plugin,
                    namespace_string: &BunString,
                    path: &BunString,
                    importer: &BunString,
                    context: *mut core::ffi::c_void,
                    kind: u8,
                );
                #[link_name = "JSBundlerPlugin__drainDeferred"]
                safe fn JSBundlerPlugin__drainDeferred(this: &mut Plugin, rejected: bool);
                #[link_name = "JSBundlerPlugin__hasOnBeforeParsePlugins"]
                safe fn JSBundlerPlugin__hasOnBeforeParsePlugins(this: &Plugin) -> i32;
                // `ctx`/`args`/`result` are opaque cookies the C++ side round-trips
                // to Rust-registered native-plugin callbacks without dereferencing
                // in `JSBundlerPlugin.cpp` itself (same posture as `matchOnLoad`
                // above); `&Plugin`/`&BunString` discharge the only direct C++-side
                // dereferences, and `should_continue_running` validity is upheld by
                // the `&Cell<i32>` borrow in the safe wrapper — no caller-side
                // precondition remains, so `safe fn`.
                #[link_name = "JSBundlerPlugin__callOnBeforeParsePlugins"]
                safe fn JSBundlerPlugin__callOnBeforeParsePlugins(
                    this: &Plugin,
                    ctx: *mut core::ffi::c_void,
                    namespace: &BunString,
                    path: &BunString,
                    args: *mut core::ffi::c_void,
                    result: *mut core::ffi::c_void,
                    should_continue_running: *mut i32,
                ) -> i32;
            }
            impl Plugin {
                /// `Plugin.drainDeferred` (JSBundler.zig) — resolve every onLoad
                /// `.defer()` promise. Zig wraps the FFI in `fromJSHostCallGeneric`
                /// for exception-scope tracking and returns `JSError!void`; the
                /// only bundler caller (`DeferredBatchTask::run_on_js_thread`) is
                /// `catch return`, so the void FFI call is the observable
                /// behaviour at this tier.
                pub fn drain_deferred(&mut self, rejected: bool) {
                    JSBundlerPlugin__drainDeferred(self, rejected)
                }

                #[inline]
                pub fn has_on_before_parse_plugins(&self) -> bool {
                    JSBundlerPlugin__hasOnBeforeParsePlugins(self) != 0
                }

                #[inline]
                pub fn call_on_before_parse_plugins(
                    &self,
                    ctx: *mut core::ffi::c_void,
                    namespace: &BunString,
                    path: &BunString,
                    args: *mut crate::parse_task::parse_worker::OnBeforeParseArguments,
                    result: *mut crate::parse_task::parse_worker::OnBeforeParseResult,
                    should_continue_running: &core::cell::Cell<i32>,
                ) -> i32 {
                    // `Cell<i32>` is repr(transparent) over `UnsafeCell<i32>`;
                    // `.as_ptr()` yields the `*mut i32` C++ expects, kept valid
                    // for the duration of the call by the `&Cell` borrow.
                    JSBundlerPlugin__callOnBeforeParsePlugins(
                        self,
                        ctx,
                        namespace,
                        path,
                        args.cast(),
                        result.cast(),
                        should_continue_running.as_ptr(),
                    )
                }

                pub fn has_any_matches(
                    &self,
                    path: &crate::ungate_support::bun_fs::Path,
                    is_on_load: bool,
                ) -> bool {
                    let namespace_string = if path.is_file() {
                        BunString::empty()
                    } else {
                        BunString::clone_utf8(path.namespace)
                    };
                    let path_string = BunString::clone_utf8(path.text);
                    // namespace_string/path_string deref on Drop
                    JSBundlerPlugin__anyMatches(self, &namespace_string, &path_string, is_on_load)
                }

                pub fn match_on_load(
                    &mut self,
                    path: &[u8],
                    namespace: &[u8],
                    context: *mut core::ffi::c_void,
                    default_loader: Loader,
                    is_server_side: bool,
                ) {
                    let _tracer = bun_core::perf::trace("JSBundler.matchOnLoad");
                    let namespace_string = if namespace.is_empty() {
                        BunString::static_(b"file")
                    } else {
                        BunString::clone_utf8(namespace)
                    };
                    let path_string = BunString::clone_utf8(path);
                    JSBundlerPlugin__matchOnLoad(
                        self,
                        &namespace_string,
                        &path_string,
                        context,
                        default_loader as u8,
                        is_server_side,
                    );
                }

                pub fn match_on_resolve(
                    &mut self,
                    path: &[u8],
                    namespace: &[u8],
                    importer: &[u8],
                    context: *mut core::ffi::c_void,
                    import_record_kind: ImportKind,
                ) {
                    let _tracer = bun_core::perf::trace("JSBundler.matchOnResolve");
                    let namespace_string = if namespace == b"file" {
                        BunString::empty()
                    } else {
                        BunString::clone_utf8(namespace)
                    };
                    let path_string = BunString::clone_utf8(path);
                    let importer_string = BunString::clone_utf8(importer);
                    JSBundlerPlugin__matchOnResolve(
                        self,
                        &namespace_string,
                        &path_string,
                        &importer_string,
                        context,
                        import_record_kind as u8,
                    );
                }
            }

            /// Mirrors `JSBundler.FileMap` — virtual in-memory files for the build.
            /// The Zig value type is `jsc.Node.BlobOrStringOrBuffer` (T6); bundler
            /// only ever reads `.slice()`, so the moved-down map stores raw bytes.
            /// `bun_runtime`'s `from_js` parses JS values via `BlobOrStringOrBuffer`
            /// in async (owning-copy) mode and inserts the extracted bytes here.
            #[derive(Default)]
            pub struct FileMap {
                pub map: bun_collections::StringHashMap<Box<[u8]>>,
            }
            impl FileMap {
                pub fn get(&self, specifier: &[u8]) -> Option<&[u8]> {
                    if self.map.is_empty() {
                        return None;
                    }
                    #[cfg(not(windows))]
                    {
                        self.map.get(specifier).map(|b| b.as_ref())
                    }
                    #[cfg(windows)]
                    {
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let normalized =
                            bun_paths::resolve_path::path_to_posix_buf(specifier, &mut **buf);
                        self.map.get(normalized).map(|b| b.as_ref())
                    }
                }
                #[inline]
                pub fn contains(&self, specifier: &[u8]) -> bool {
                    if self.map.is_empty() {
                        return false;
                    }
                    #[cfg(not(windows))]
                    {
                        self.map.contains_key(specifier)
                    }
                    #[cfg(windows)]
                    {
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let normalized =
                            bun_paths::resolve_path::path_to_posix_buf(specifier, &mut **buf);
                        self.map.contains_key(normalized)
                    }
                }
                /// Returns a `resolver::Result` for a file in the map, or `None` if
                /// not found. Handles direct key matches and relative specifiers
                /// joined against `dirname(source_file)` (with Windows
                /// drive-letter / separator normalization).
                ///
                /// `arena` is the build's bump arena (`BundleV2::arena()`);
                /// the matched key is copied into it so the returned
                /// `bun_resolver::Result`'s `Path<'static>` borrows arena memory
                /// (lives for the entire build pass) instead of the map's key
                /// storage.
                pub fn resolve(
                    &self,
                    arena: &bun_alloc::Arena,
                    source_file: &[u8],
                    specifier: &[u8],
                ) -> Option<bun_resolver::Result> {
                    if self.map.is_empty() {
                        return None;
                    }

                    // SAFETY: ARENA — `arena` is the build-pass bump arena
                    // (never freed before the `Result` is consumed); detaching the
                    // borrow lifetime matches the established `Path<'static>`
                    // convention used throughout `bun_resolver` (PORTING.md
                    // §Lifetimes: ARENA → `&'bump T`).
                    let dupe = |key: &[u8]| -> &'static [u8] {
                        unsafe { bun_ptr::detach_lifetime(arena.alloc_slice_copy(key)) }
                    };

                    // Direct key match (must use `getKey` to return the map-owned
                    // key, not the parameter).
                    #[cfg(not(windows))]
                    if let Some((key, _)) = self.map.get_key_value(specifier) {
                        return Some(Self::result_for_key(dupe(key.as_ref())));
                    }
                    #[cfg(windows)]
                    {
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let normalized =
                            bun_paths::resolve_path::path_to_posix_buf(specifier, &mut **buf);
                        if let Some((key, _)) = self.map.get_key_value(normalized) {
                            return Some(Self::result_for_key(dupe(key.as_ref())));
                        }
                    }

                    // Also try joining a relative specifier against the importer's
                    // directory. Relative = not posix-absolute and not Windows
                    // drive-absolute (e.g. `C:/`).
                    if !specifier.is_empty() && !bun_paths::is_absolute_loose(specifier) {
                        // `source_file` may itself be relative (e.g. on Windows
                        // when the bundler stores paths relative to cwd).
                        let mut abs_source_buf = bun_paths::path_buffer_pool::get();
                        let abs_source_file: &[u8] = if bun_paths::is_absolute_loose(source_file) {
                            source_file
                        } else {
                            bun_resolver::fs::FileSystem::instance()
                                .abs_buf(&[source_file], &mut *abs_source_buf)
                        };

                        // Normalize `source_file` to forward slashes (Windows paths
                        // from the real filesystem may use backslashes).
                        let mut source_file_buf = bun_paths::path_buffer_pool::get();
                        let normalized_source_file = bun_paths::resolve_path::path_to_posix_buf::<u8>(
                            abs_source_file,
                            &mut **source_file_buf,
                        );

                        let mut buf = bun_paths::path_buffer_pool::get();
                        let source_dir = bun_paths::resolve_path::dirname::<
                            bun_paths::platform::Posix,
                        >(normalized_source_file);
                        // If `dirname` returns empty but the path has a drive
                        // letter, use the drive root.
                        let effective_source_dir: &[u8] = if source_dir.is_empty() {
                            if normalized_source_file.len() >= 3
                                && normalized_source_file[1] == b':'
                                && normalized_source_file[2] == b'/'
                            {
                                &normalized_source_file[0..3] // "C:/"
                            } else if !normalized_source_file.is_empty()
                                && normalized_source_file[0] == b'/'
                            {
                                b"/"
                            } else {
                                bun_resolver::fs::FileSystem::instance().top_level_dir
                            }
                        } else {
                            source_dir
                        };
                        // `.loose` preserves Windows drive letters; normalize
                        // separators in-place on Windows afterwards.
                        let joined_len = bun_paths::resolve_path::join_abs_string_buf::<
                            bun_paths::platform::Loose,
                        >(
                            effective_source_dir, &mut **buf, &[specifier]
                        )
                        .len();
                        if cfg!(windows) {
                            bun_paths::resolve_path::platform_to_posix_in_place::<u8>(
                                &mut buf[0..joined_len],
                            );
                        }
                        let joined = &buf[0..joined_len];
                        if let Some((key, _)) = self.map.get_key_value(joined) {
                            return Some(Self::result_for_key(dupe(key.as_ref())));
                        }
                    }

                    None
                }

                /// Build a `bun_resolver::Result` for a matched key. `key` must
                /// already satisfy `'static` — see [`resolve`], which copies the
                /// map-owned key into the build's bump arena before calling here so
                /// the resulting `Path<'static>` borrows arena memory rather than
                /// forging a `'static` from a map borrow.
                #[inline]
                fn result_for_key(key: &'static [u8]) -> bun_resolver::Result {
                    bun_resolver::Result {
                        path_pair: bun_resolver::PathPair {
                            primary: crate::ungate_support::bun_fs::Path::init_with_namespace(
                                key, b"file",
                            ),
                            ..Default::default()
                        },
                        module_type: crate::options::ModuleType::Unknown,
                        ..Default::default()
                    }
                }
            }

            /// Mirrors `JSBundler.Resolve.MiniImportRecord` (zig:1242).
            #[derive(Clone, Default)]
            pub struct MiniImportRecord {
                pub kind: ImportKind,
                pub source_file: Box<[u8]>,
                pub namespace: Box<[u8]>,
                pub specifier: Box<[u8]>,
                pub importer_source_index: u32,
                pub import_record_index: u32,
                pub range: bun_ast::Range,
                pub original_target: Target,
            }

            /// Mirrors `JSBundler.Resolve.Value.success` payload.
            #[derive(Clone, Default)]
            pub struct ResolveSuccess {
                pub path: Box<[u8]>,
                pub namespace: Box<[u8]>,
                pub external: bool,
            }
            /// Mirrors `JSBundler.Resolve.Value` (`union(enum)`).
            #[derive(Default)]
            pub enum ResolveValue {
                Err(bun_ast::Msg),
                Success(ResolveSuccess),
                NoMatch,
                #[default]
                Pending,
                Consumed,
            }
            impl ResolveValue {
                #[inline]
                pub fn consume(&mut self) -> ResolveValue {
                    core::mem::replace(self, ResolveValue::Consumed)
                }
            }

            /// Mirrors `JSBundler.Resolve` (zig:1234). Both `js_task` and `task`
            /// are the real lower-tier `bun_event_loop` types, so `dispatch()` /
            /// `run_on_js_thread()` are implemented inherently (no T6 hook).
            pub struct Resolve {
                pub bv2: *mut BundleV2<'static>,
                pub import_record: MiniImportRecord,
                pub value: ResolveValue,
                pub js_task: bun_event_loop::AnyTask::AnyTask,
                /// `jsc.AnyEventLoop.Task` — intrusive node for the Mini-loop queue.
                pub task: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext,
            }
            impl Default for Resolve {
                fn default() -> Self {
                    Self {
                    bv2: core::ptr::null_mut(),
                    import_record: MiniImportRecord::default(),
                    value: ResolveValue::Pending,
                    js_task: bun_event_loop::AnyTask::AnyTask::default(),
                    task: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext::default(),
                }
                }
            }
            impl Resolve {
                pub fn init(bv2: &mut BundleV2<'_>, record: MiniImportRecord) -> Self {
                    Self {
                    // SAFETY: lifetime erased — Resolve is owned by the dispatch
                    // chain and never outlives `bv2` (mirrors Zig raw `*BundleV2`).
                    bv2: std::ptr::from_mut::<BundleV2<'_>>(bv2).cast::<BundleV2<'static>>(),
                    import_record: record,
                    value: ResolveValue::Pending,
                    js_task: bun_event_loop::AnyTask::AnyTask::default(),
                    task: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext::default(),
                }
                }
                /// Hops to the JS thread to call the `onResolve` plugin chain.
                /// Zig spec (JSBundler.zig:1311):
                ///   `this.js_task = AnyTask.init(this);
                ///    bv2.jsLoopForPlugins().enqueueTaskConcurrent(
                ///      jsc.ConcurrentTask.create(this.js_task.task()))`
                pub fn dispatch(&mut self) {
                    self.js_task = bun_event_loop::AnyTask::AnyTask {
                        ctx: core::ptr::NonNull::new(
                            std::ptr::from_mut::<Self>(self).cast::<core::ffi::c_void>(),
                        ),
                        callback: Self::run_on_js_thread_wrap,
                    };
                    let task =
                        bun_event_loop::ConcurrentTask::ConcurrentTask::create(self.js_task.task());
                    // SAFETY: `bv2` is a valid backref set by `init`; plugins is
                    // Some (asserted by `enqueue_on_js_loop_for_plugins`).
                    unsafe { (*self.bv2).enqueue_on_js_loop_for_plugins(task) };
                }
                pub fn run_on_js_thread(&mut self) {
                    let kind = self.import_record.kind;
                    // PORT NOTE: reshaped for borrowck — capture the erased self
                    // pointer before borrowing fields immutably for the FFI call.
                    let self_ptr = std::ptr::from_mut::<Self>(self).cast::<core::ffi::c_void>();
                    // SAFETY: `bv2` is a valid backref set by `init`; the plugin
                    // storage is disjoint from `self`, so the `&mut JSBundlerPlugin`
                    // returned by `plugins_mut()` does not alias the
                    // `&self.import_record.*` borrows below.
                    unsafe { &mut *self.bv2 }
                        .plugins_mut()
                        .expect("plugins")
                        .match_on_resolve(
                            &self.import_record.specifier,
                            &self.import_record.namespace,
                            &self.import_record.source_file,
                            self_ptr,
                            kind,
                        );
                }
                fn run_on_js_thread_wrap(
                    ctx: *mut core::ffi::c_void,
                ) -> bun_event_loop::JsResult<()> {
                    // SAFETY: ctx was stored from `*mut Resolve` in `dispatch`.
                    unsafe { bun_ptr::callback_ctx::<Resolve>(ctx) }.run_on_js_thread();
                    Ok(())
                }
            }

            /// Mirrors `JSBundler.Load.Value.success` payload.
            #[derive(Clone, Default)]
            pub struct LoadSuccess {
                pub source_code: Box<[u8]>,
                pub loader: Loader,
            }
            /// Mirrors `JSBundler.Load.Value` (`union(enum)`).
            #[derive(Default)]
            pub enum LoadValue {
                Err(bun_ast::Msg),
                Success(LoadSuccess),
                #[default]
                Pending,
                NoMatch,
                Consumed,
            }
            impl LoadValue {
                #[inline]
                pub fn consume(&mut self) -> LoadValue {
                    core::mem::replace(self, LoadValue::Consumed)
                }
            }

            /// Mirrors `JSBundler.Load` (zig:1369).
            pub struct Load {
                pub bv2: *mut BundleV2<'static>,
                pub source_index: bun_ast::Index,
                pub default_loader: Loader,
                pub path: Box<[u8]>,
                pub namespace: Box<[u8]>,
                pub value: LoadValue,
                pub parse_task: bun_ptr::BackRef<ParseTask>,
                /// Faster path: skip the extra threadpool dispatch when the file is not found.
                pub was_file: bool,
                /// Defer may only be called once.
                pub called_defer: bool,
                pub js_task: bun_event_loop::AnyTask::AnyTask,
                /// `jsc.AnyEventLoop.Task` — intrusive node for the Mini-loop queue
                /// (used by `onDefer` to notify the bundler thread when it runs
                /// under a `MiniEventLoop`).
                pub task: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext,
            }
            impl Load {
                pub fn init(bv2: &mut BundleV2<'_>, parse: &mut ParseTask) -> Self {
                    let default_loader = parse
                        .path
                        .loader(&bv2.transpiler.options.loaders)
                        .unwrap_or(Loader::Js);
                    Self {
                    bv2: std::ptr::from_mut::<BundleV2<'_>>(bv2).cast::<BundleV2<'static>>(),
                    parse_task: bun_ptr::BackRef::new_mut(parse),
                    source_index: parse.source_index,
                    default_loader,
                    value: LoadValue::Pending,
                    path: parse.path.text.to_vec().into_boxed_slice(),
                    namespace: parse.path.namespace.to_vec().into_boxed_slice(),
                    was_file: false,
                    called_defer: false,
                    js_task: bun_event_loop::AnyTask::AnyTask::default(),
                    task: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext::default(),
                }
                }
                /// Raw backref to the owning `BundleV2`.
                ///
                /// No `&`/`&mut`-returning accessor is provided: the bundle is
                /// reachable from both the bundler thread and JS-thread plugin
                /// callbacks, and several callers (`on_load_async`,
                /// `on_load_from_js_loop`) need `&mut BundleV2` *alongside*
                /// `&mut Load`, which a borrowing accessor cannot express. Callers
                /// must keep the raw deref + SAFETY note locally.
                #[inline]
                pub fn bv2_ptr(&self) -> *mut BundleV2<'static> {
                    self.bv2
                }
                /// Shared access to the heap-allocated `ParseTask` this load wraps.
                ///
                /// `parse_task` is a `BackRef` set from `&mut ParseTask` in `init`
                /// (never null) and the task outlives the `Load` — it is only
                /// handed to the thread-pool *after* the plugin load resolves, so
                /// no concurrent mutation overlaps a `&` borrow here.
                #[inline]
                pub fn parse_task(&self) -> &ParseTask {
                    self.parse_task.get()
                }
                /// Exclusive access to the wrapped `ParseTask`.
                ///
                /// SAFETY (encapsulated): see `parse_task()`. `&mut self` guarantees
                /// the `Load` itself is uniquely borrowed; the `ParseTask` is not
                /// yet scheduled at any call site that uses this accessor.
                #[inline]
                pub fn parse_task_mut(&mut self) -> &mut ParseTask {
                    // SAFETY: see fn doc — exclusivity established by `&mut self`;
                    // backref liveness established by the `BackRef` invariant.
                    unsafe { self.parse_task.get_mut() }
                }
                #[inline]
                pub fn bake_graph(&self) -> crate::bake_types::Graph {
                    self.parse_task().known_target.bake_graph()
                }
                /// Hops to the JS thread to call the `onLoad` plugin chain.
                /// Zig spec (JSBundler.zig:1449):
                ///   `this.js_task = AnyTask.init(this);
                ///    let concurrent_task = jsc.ConcurrentTask.createFrom(&this.js_task);
                ///    bv2.jsLoopForPlugins().enqueueTaskConcurrent(concurrent_task)`
                pub fn dispatch(&mut self) {
                    self.js_task = bun_event_loop::AnyTask::AnyTask {
                        ctx: core::ptr::NonNull::new(
                            std::ptr::from_mut::<Self>(self).cast::<core::ffi::c_void>(),
                        ),
                        callback: Self::run_on_js_thread_wrap,
                    };
                    let concurrent_task =
                        bun_event_loop::ConcurrentTask::ConcurrentTask::create(self.js_task.task());
                    // SAFETY: `bv2` is a valid backref; plugins is Some (asserted
                    // by `enqueue_on_js_loop_for_plugins`).
                    unsafe {
                        (*self.bv2).enqueue_on_js_loop_for_plugins(concurrent_task);
                    }
                }
                pub fn run_on_js_thread(&mut self) {
                    let is_server_side = self.bake_graph() != crate::bake_types::Graph::Client;
                    let default_loader = self.default_loader;
                    // PORT NOTE: reshaped for borrowck — capture the erased self
                    // pointer before borrowing fields immutably for the FFI call.
                    let self_ptr = std::ptr::from_mut::<Self>(self).cast::<core::ffi::c_void>();
                    // SAFETY: `bv2` is a valid backref set by `init`; the plugin
                    // storage is disjoint from `self`, so the `&mut JSBundlerPlugin`
                    // returned by `plugins_mut()` does not alias the
                    // `&self.path` / `&self.namespace` borrows below.
                    unsafe { &mut *self.bv2 }
                        .plugins_mut()
                        .expect("plugins")
                        .match_on_load(
                            &self.path,
                            &self.namespace,
                            self_ptr,
                            default_loader,
                            is_server_side,
                        );
                }
                fn run_on_js_thread_wrap(
                    ctx: *mut core::ffi::c_void,
                ) -> bun_event_loop::JsResult<()> {
                    // SAFETY: ctx was stored from `*mut Load` in `dispatch`.
                    unsafe { bun_ptr::callback_ctx::<Load>(ctx) }.run_on_js_thread();
                    Ok(())
                }
            }
        }
    }

    /// `SavedFile` is a unit struct in Zig
    /// (src/bundler_jsc/output_file_jsc.zig:4) — its only member is `toJS`, which
    /// is JSC-bound and stays in T6. The bundler stores it as an `OutputFile` value
    /// tag, so a unit struct here is sufficient.
    pub mod saved_file {
        #[derive(Default, Clone, Copy)]
        pub struct SavedFile;
    }

    // ── crate-root re-exports for forward-refs left by move-out ───────────────
    pub use self::bake_types::{HmrRuntimeSide, get_hmr_runtime};
    pub(crate) use bun_ast::RuntimeTranspilerCache;
    /// `crate::bundle_v2::JSBundlerPlugin` — see BundleThread.rs.
    pub type JSBundlerPlugin = self::api::JSBundler::Plugin;
    pub type FileMap = self::api::JSBundler::FileMap;

    use bun_paths as resolve_path;
    use bun_sourcemap as SourceMap;

    use crate::AstBuilder::AstBuilder;
    use crate::DeferredBatchTask::DeferredBatchTask;
    use crate::Graph::Graph;
    use crate::LinkerContext;
    use crate::PathToSourceIndexMap::PathToSourceIndexMap;
    use crate::ServerComponentParseTask::ServerComponentParseTask;
    use crate::barrel_imports;
    use crate::cache::Entry as CacheEntry;
    use crate::chunk::{self, Chunk, ChunkImport};
    use crate::linker_graph::LinkerGraph;
    use crate::options::{self, Loader, Target};
    use crate::parse_task::{self, ParseTask};
    use crate::thread_pool::ThreadPool;
    use crate::ungate_support::entry_point;

    pub use crate::BundleThread::BundleThread;

    bun_core::declare_scope!(part_dep_tree, visible);
    bun_core::declare_scope!(Bundle, visible);
    bun_core::declare_scope!(scan_counter, visible);
    bun_core::declare_scope!(ReachableFiles, visible);
    bun_core::declare_scope!(TreeShake, hidden);
    bun_core::declare_scope!(PartRanges, hidden);
    // `ContentHasher` scope moved to `ungate_support.rs` alongside the canonical
    // `ContentHasher` struct (DEDUP D059).
    // Zig: `bun.Output.scoped(.watcher, .visible)` — lowercase to avoid colliding
    // with the `Watcher` type alias (hot-reloader handle) in this module.
    bun_core::declare_scope!(watcher, visible);

    pub use bun_js_printer::MangledProps;

    // ══════════════════════════════════════════════════════════════════════════
    // CYCLEBREAK §Dispatch — vtables/hooks for T6 GENUINE deps (jsc/bake/runtime).
    // Low tier (bundler) names no high-tier types. High tier (runtime) provides
    // static instances and registers hooks at init. See PORTING.md §Dispatch.
    // ══════════════════════════════════════════════════════════════════════════
    pub mod dispatch {
        pub use crate::{DevServerHandle, DevServerHandleKind};

        impl DevServerHandle {
            #[inline]
            pub fn put_or_overwrite_asset_erased<P>(
                &self,
                path: &P,
                contents: &[u8],
                content_hash: u64,
            ) -> Result<(), bun_core::Error> {
                self.put_or_overwrite_asset(
                    core::ptr::from_ref::<P>(path).cast::<()>(),
                    contents,
                    content_hash,
                )
            }
        }

        unsafe extern "Rust" {
            /// Defined `#[no_mangle]` in `bun_jsc::cached_bytecode`. Generic
            /// "generate JSC bytecode off the main JS thread" helper — marks the
            /// calling thread as bytecode-only, initializes JSC, generates, and
            /// returns an owned copy of the bytes. Definer-prefixed (`__bun_jsc_*`).
            /// All arguments are safe Rust types (no raw-pointer preconditions),
            /// so the link-time-resolved body upholds Rust's invariants on its own.
            safe fn __bun_jsc_generate_cached_bytecode(
                format: crate::options_impl::Format,
                source: &[u8],
                source_provider_url: &mut bun_core::String,
            ) -> Option<Box<[u8]>>;
        }

        unsafe extern "Rust" {
            /// Defined `#[no_mangle]` in `bun_jsc::hot_reloader`. Installs a
            /// `NewHotReloader<BundleV2, AnyEventLoop, true>` watcher on the given
            /// `BundleV2` (Zig: `Watcher.enableHotModuleReloading(this, null)` in
            /// `BundleV2.init` — bundle_v2.zig:994). The bundler can't name the
            /// reloader generic (T6), so this is a definer-prefixed extern hook.
            fn __bun_jsc_enable_hot_module_reloading_for_bundler(bv2: *mut ());
        }

        /// `Watcher.enableHotModuleReloading(this, null)` for `bun build --watch`.
        #[inline]
        pub fn enable_hot_module_reloading_for_bundler(bv2: *mut super::BundleV2<'_>) {
            // SAFETY: link-time-resolved Rust-ABI fn in `bun_jsc::hot_reloader`.
            // Not `safe fn`: the callee re-types the erased `*mut ()` as
            // `*mut BundleV2<'static>` and dereferences it, so `bv2` must point to
            // a live `BundleV2` whose backing allocation outlives the watcher
            // (sole caller is `BundleV2::init` with the leaked CLI arena).
            unsafe { __bun_jsc_enable_hot_module_reloading_for_bundler(bv2.cast()) }
        }

        /// Bytecode generation entry point for the linker. Mirrors the Zig
        /// `jsc.VirtualMachine.is_bundler_thread_for_bytecode_cache = true;
        ///  jsc.initialize(false); jsc.CachedBytecode.generate(...)` sequence.
        #[inline]
        pub fn generate_cached_bytecode(
            format: crate::options_impl::Format,
            source: &[u8],
            source_provider_url: &mut bun_core::String,
        ) -> Option<Box<[u8]>> {
            __bun_jsc_generate_cached_bytecode(format, source, source_provider_url)
        }

        /// CYCLEBREAK GENUINE: `JSBundleCompletionTask` (JSBundler.zig) — the
        /// concrete struct lives in `bun_runtime` (its fields name `Config`/
        /// `Plugin`/`HTMLBundle::Route`). The bundler reads exactly two things
        /// from it (`result == .err` and `jsc_event_loop.enqueueTaskConcurrent`),
        /// so the high tier hands the bundler an erased owner + `&'static` vtable
        /// pair (same shape as [`DevServerHandle`]). PERF(port): was direct field
        /// access in Zig.
        pub struct CompletionDispatch {
            /// Zig: `completion.result == .err`
            pub result_is_err: unsafe fn(core::ptr::NonNull<super::JSBundleCompletionTask>) -> bool,
            /// Zig: `completion.jsc_event_loop.enqueueTaskConcurrent(task)` — folds
            /// the field access + enqueue so the bundler needn't name `*jsc.EventLoop`.
            pub enqueue_task_concurrent: unsafe fn(
                core::ptr::NonNull<super::JSBundleCompletionTask>,
                *mut bun_event_loop::ConcurrentTask::ConcurrentTask,
            ),
        }
        #[derive(Copy, Clone)]
        pub struct CompletionHandle {
            pub owner: core::ptr::NonNull<super::JSBundleCompletionTask>,
            pub vtable: &'static CompletionDispatch,
        }
        // SAFETY: erased `*mut JSBundleCompletionTask` backref — set by the JS
        // thread, read by the bundle thread; `enqueue_task_concurrent` is the only
        // cross-thread call and it goes through `jsc::EventLoop`'s lock-free queue.
        unsafe impl Send for CompletionHandle {}
        unsafe impl Sync for CompletionHandle {}
        impl CompletionHandle {
            #[inline]
            pub fn result_is_err(&self) -> bool {
                // SAFETY: vtable contract.
                unsafe { (self.vtable.result_is_err)(self.owner) }
            }
            #[inline]
            pub fn enqueue_task_concurrent(
                &self,
                task: *mut bun_event_loop::ConcurrentTask::ConcurrentTask,
            ) {
                // SAFETY: vtable contract.
                unsafe { (self.vtable.enqueue_task_concurrent)(self.owner, task) }
            }
        }
    }

    /// `bun.jsc.AnyEventLoop` — re-export the linker's alias
    /// (`Option<NonNull<bun_event_loop::AnyEventLoop>>`).
    pub use crate::ungate_support::EventLoop;

    /// `JSBundleCompletionTask` (JSBundler.zig) — typed-ptr marker for
    /// `BundleV2.completion`. The concrete struct lives in `bun_runtime` (its
    /// fields name `Config`/`Plugin`/`HTMLBundle::Route`); the bundler only ever
    /// holds a `NonNull<JSBundleCompletionTask>` inside [`dispatch::CompletionHandle`]
    /// and never dereferences it. Nomicon opaque-FFI pattern: ZST with
    /// `PhantomData<(*mut u8, PhantomPinned)>` so it is `!Send + !Sync + !Unpin`
    /// and has no usable size/layout in this crate.
    bun_opaque::opaque_ffi! { pub struct JSBundleCompletionTask; }

    // DEDUP(D059): `generic_path_with_pretty_initialized` is canonically defined in
    // `crate::ungate_support`. After D090 the `Fs::Path` / `bun_paths::fs::Path<'static>`
    // distinction is purely a `'static` alias, so the in-module caller passes
    // through directly.

    /// Erase `&[u8]` to `&'static [u8]` for storage in lifetime-erased
    /// `Path<'static>` slots (`ImportRecord.path`, `Graph.input_files`).
    ///
    /// # Safety
    /// Caller guarantees `s` is one of:
    ///   - a `'static` literal,
    ///   - interned in `FilenameStore`/`DirnameStore` (process-lifetime BSS lists),
    ///   - allocated from the bundle-pass arena (`BundleV2::arena()`), in which
    ///     case the returned reference is valid only for the bundle pass and the
    ///     consuming `Path` must not outlive it.
    /// All call sites in this file satisfy one of these; this is the documented
    /// Phase-A ARENA convention (PORTING.md §Type Mapping: arena-owned struct
    /// fields use erased lifetimes).
    #[inline(always)]
    pub(crate) unsafe fn interned_slice(s: &[u8]) -> &'static [u8] {
        // SAFETY: upheld by caller per fn contract.
        unsafe { bun_ptr::detach_lifetime(s) }
    }
    /// Erase a resolver-borrowed `Path<'_>` to `'static`. Safe only because every
    /// caller passes paths whose backing bytes are arena-interned for the bundle's
    /// lifetime (see `interned_slice` / `dupe_alloc`).
    #[inline]
    pub(crate) fn path_as_static(p: Fs::Path<'_>) -> Fs::Path<'static> {
        // SAFETY: caller contract above.
        unsafe { p.into_static() }
    }

    // Unified with the canonical definitions at the parent module level (this
    // avoids two distinct nominal `BundleV2`/`PendingImport`/`BakeOptions` types
    // that previously caused widespread "expected `BundleV2`, found `BundleV2`"
    // errors in cross-module call sites).
    pub use super::{BakeOptions, BundleV2, PendingImport};

    impl<'a> BundleV2<'a> {
        /// Zig: `jsLoopForPlugins().enqueueTaskConcurrent(task)`. The Rust port
        /// folds the lookup + enqueue so the bundler never dereferences
        /// `JSBundleCompletionTask` (its layout lives in `bun_runtime`); the
        /// `completion` handle carries the `&'static` vtable.
        /// PERF(port): was inline `switch (this.loop().*)` + direct field access.
        pub fn enqueue_on_js_loop_for_plugins(
            &mut self,
            task: *mut bun_event_loop::ConcurrentTask::ConcurrentTask,
        ) {
            debug_assert!(self.plugins.is_some());
            if let Some(completion) = self.completion {
                // From Bun.build — `completion.jsc_event_loop.enqueueTaskConcurrent(task)`.
                completion.enqueue_task_concurrent(task);
                return;
            }
            // From bake where the loop running the bundle is also the loop running
            // the plugins (Zig: `switch (this.loop().*) { .js => |l| l, .mini => @panic }`).
            // `any_loop_mut` centralises the BACKREF deref of `linker.r#loop`.
            match &*self.any_loop_mut() {
                bun_event_loop::AnyEventLoop::Js { owner } => {
                    owner.enqueue_task_concurrent(task);
                }
                bun_event_loop::AnyEventLoop::Mini(_) => {
                    panic!("No JavaScript event loop for transpiler plugins to run on");
                }
            }
        }

        fn ensure_client_transpiler(&mut self) {
            if self.client_transpiler.is_none() {
                let _ = self
                    .initialize_client_transpiler()
                    .unwrap_or_else(|e: Error| {
                        panic!("Failed to initialize client transpiler: {}", e.name());
                    });
            }
        }

        #[cold]
        pub fn initialize_client_transpiler(&mut self) -> Result<&mut Transpiler<'a>, Error> {
            // bundle_v2.zig:198-241.
            //
            // PORT NOTE: Zig does `client_transpiler.* = this_transpiler.*` (bitwise
            // struct copy into an arena slot — no destructors). The Rust port
            // builds a fresh owned `Transpiler` via `Transpiler::for_worker`
            // (per-field deep clone), mutates the browser-specific options with
            // ordinary assignment (every field is owned by the clone, so `Drop` on
            // the overwritten value is correct), then boxes it on the global heap
            // (NOT the bump arena — the clone holds `Box`/`Vec`/`MimallocArena`
            // fields that need `Drop` to run) and wires the self-referential
            // `linker`/`macro_context`. The box is parked on
            // `self.owned_client_transpiler` so `deinit_without_freeing_arena`
            // releases it.

            // `arena` is only the scratch param for `Transpiler::for_worker`; the
            // returned `Transpiler` itself is NOT placed in it.
            // SAFETY: `graph.heap` outlives the bundle pass; erase the `&self`
            // borrow so the `'a` widen inside `for_worker` doesn't keep `self`
            // borrowed.
            let arena: &'a bun_alloc::Arena =
                unsafe { bun_ptr::detach_lifetime_ref::<bun_alloc::Arena>(self.arena()) };

            let this_transpiler: &Transpiler<'a> = &*self.transpiler;
            let this_compile = this_transpiler.options.compile;
            let this_env = this_transpiler.env;

            // SAFETY: `self.transpiler` (and the data its `&'a` fields borrow)
            // outlives this `BundleV2<'a>`; `for_worker` widens those borrows to
            // the same `'a`.
            let mut ct: Transpiler<'a> =
                unsafe { Transpiler::for_worker(this_transpiler, arena, this_transpiler.log) };

            ct.options.target = Target::Browser;
            ct.options.main_fields = Target::Browser
                .default_main_fields()
                .iter()
                .map(|s| s.as_bytes().to_vec().into_boxed_slice())
                .collect();
            ct.options.conditions =
                options::ESMConditions::init(Target::Browser.default_conditions(), false, &[])?;

            // We need to make sure it has [hash] in the names so we don't get conflicts.
            if this_compile {
                ct.options.asset_naming = options::PathTemplate::ASSET
                    .data
                    .to_vec()
                    .into_boxed_slice();
                ct.options.chunk_naming = options::PathTemplate::CHUNK
                    .data
                    .to_vec()
                    .into_boxed_slice();
                ct.options.entry_naming = b"./[name]-[hash].[ext]".to_vec().into_boxed_slice();
                // Use "/" so that asset URLs in HTML are absolute (e.g. "/chunk-abc.js"
                // instead of "./chunk-abc.js"). Relative paths break when the HTML is
                // served from a nested route like "/foo/".
                ct.options.public_path = b"/".to_vec().into_boxed_slice();
            }

            // Move into a stable heap slot, then wire self-refs at the final
            // address. `Box` (global mimalloc heap) so `Drop` runs on the
            // deep-cloned `BundleOptions`/`Resolver` fields; `arena.alloc` would
            // leak them (bumpalo never drops).
            let mut boxed: Box<Transpiler<'a>> = Box::new(ct);
            // Zig: `setLog` / `setAllocator` / `linker.resolver = &resolver` /
            // `macro_context = MacroContext.init(transpiler)` /
            // `resolver.caches = CacheSet.init(alloc)` — all handled by
            // `for_worker` + `wire_after_move`.
            boxed.wire_after_move();

            // `configure_defines` early-returns on `options.defines_loaded` (cloned
            // as `true`); kept for spec parity.
            boxed.configure_defines()?;

            // Zig: `client_transpiler.resolver.opts = client_transpiler.options;` —
            // re-project the resolver subset now that `target`/`conditions` etc.
            // have been overwritten for the browser.
            boxed.sync_resolver_opts();
            // Zig: `client_transpiler.resolver.env_loader = client_transpiler.env;`
            boxed.resolver.env_loader = NonNull::new(this_env.cast());

            // Park the owning Box first, then derive both the published `NonNull`
            // and the returned `&mut` from its final resting place. Taking the
            // pointer *before* moving `boxed` into `self` would give it stale
            // provenance under Stacked Borrows (Box retags on move and asserts
            // uniqueness, invalidating any previously-derived raw pointer).
            self.owned_client_transpiler = Some(boxed);
            let ct: &mut Transpiler<'a> = self.owned_client_transpiler.as_deref_mut().unwrap();
            self.client_transpiler = Some(NonNull::from(&mut *ct).into());
            Ok(ct)
        }

        /// By calling this function, it implies that the returned log *will* be
        /// written to. For DevServer, this allocates a per-file log for the sources
        /// it is called on. Function must be called on the bundle thread.
        pub fn log_for_resolution_failures(
            &mut self,
            abs_path: &[u8],
            bake_graph: bake::Graph,
        ) -> &mut bun_ast::Log {
            if let Some(dev) = self.dev_server_handle() {
                // CYCLEBREAK GENUINE: DevServer → vtable. PERF(port): was inline switch.
                // SAFETY: owner is a live *mut DevServer per handle invariant.
                return unsafe { &mut *dev.log_for_resolution_failures(abs_path, bake_graph) };
            }
            // SAFETY: `transpiler.log` is set from a live `*mut Log` in `init` and
            // outlives `BundleV2`.
            self.transpiler.log_mut()
        }
    }

    pub struct ReachableFileVisitor<'a> {
        pub reachable: Vec<Index>,
        pub visited: DynamicBitSet,
        pub all_import_records: &'a mut [import_record::List],
        pub all_loaders: &'a [Loader],
        pub all_urls_for_css: &'a [&'a [u8]],
        pub redirects: &'a [u32],
        // PORT NOTE: Zig copied the map by value (cheap shallow copy). The Rust
        // `PathToSourceIndexMap` is `!Clone` and the field is unread in `visit`, so
        // store a raw backref to satisfy the struct shape without forcing `Clone`.
        pub redirect_map: *const PathToSourceIndexMap,
        pub dynamic_import_entry_points: &'a mut ArrayHashMap<IndexInt, ()>,
        /// Files which are Server Component Boundaries
        pub scb_bitset: Option<DynamicBitSetUnmanaged>,
        pub scb_list: server_component_boundary::Slice<'a>,

        /// Files which are imported by JS and inlined in CSS
        pub additional_files_imported_by_js_and_inlined_in_css: &'a mut DynamicBitSetUnmanaged,
        /// Files which are imported by CSS and inlined in CSS
        pub additional_files_imported_by_css_and_inlined: &'a mut DynamicBitSetUnmanaged,
    }

    impl<'a> ReachableFileVisitor<'a> {
        const MAX_REDIRECTS: usize = 64;

        // Find all files reachable from all entry points. This order should be
        // deterministic given that the entry point order is deterministic, since the
        // returned order is the postorder of the graph traversal and import record
        // order within a given file is deterministic.
        #[cold]
        pub fn visit<const CHECK_DYNAMIC_IMPORTS: bool>(
            &mut self,
            source_index: Index,
            was_dynamic_import: bool,
        ) {
            if source_index.is_invalid() {
                return;
            }

            if self.visited.is_set(source_index.get() as usize) {
                if CHECK_DYNAMIC_IMPORTS {
                    if was_dynamic_import {
                        self.dynamic_import_entry_points
                            .put(source_index.get(), ())
                            .expect("unreachable");
                    }
                }
                return;
            }
            self.visited.set(source_index.get() as usize);

            if let Some(scb_bitset) = &self.scb_bitset {
                if scb_bitset.is_set(source_index.get() as usize) {
                    let scb_index = self
                        .scb_list
                        .get_index(source_index.get())
                        .expect("unreachable");
                    self.visit::<CHECK_DYNAMIC_IMPORTS>(
                        Index::init(self.scb_list.list.items_reference_source_index()[scb_index]),
                        false,
                    );
                    self.visit::<CHECK_DYNAMIC_IMPORTS>(
                        Index::init(self.scb_list.list.items_ssr_source_index()[scb_index]),
                        false,
                    );
                }
            }

            let is_js = self.all_loaders[source_index.get() as usize].is_javascript_like();
            let is_css = self.all_loaders[source_index.get() as usize].is_css();

            let import_record_list_id = source_index;
            // when there are no import records, v index will be invalid
            if (import_record_list_id.get() as usize) < self.all_import_records.len() {
                // PORT NOTE: reshaped for borrowck — split borrow of all_import_records
                let import_records_len =
                    self.all_import_records[import_record_list_id.get() as usize].len() as usize;
                for ir_idx in 0..import_records_len {
                    let import_record = &mut self.all_import_records
                        [import_record_list_id.get() as usize]
                        .slice_mut()[ir_idx];
                    let mut other_source = import_record.source_index;
                    if other_source.is_valid() {
                        let mut redirect_count: usize = 0;
                        while let Some(redirect_id) =
                            get_redirect_id(self.redirects[other_source.get() as usize])
                        {
                            // PORT NOTE: reshaped for borrowck — copy out the redirect target's
                            // (source_index, path) before re-borrowing `all_import_records` mutably.
                            let (other_src_idx, other_path) = {
                                let other_import_records =
                                    self.all_import_records[other_source.get() as usize].slice();
                                let other_import_record =
                                    &other_import_records[redirect_id as usize];
                                (
                                    other_import_record.source_index,
                                    other_import_record.path.clone(),
                                )
                            };
                            let import_record = &mut self.all_import_records
                                [import_record_list_id.get() as usize]
                                .slice_mut()[ir_idx];
                            import_record.source_index = other_src_idx;
                            import_record.path = other_path;
                            other_source = other_src_idx;
                            if redirect_count == Self::MAX_REDIRECTS {
                                import_record.path.is_disabled = true;
                                import_record.source_index = Index::INVALID;
                                break;
                            }

                            // Handle redirects to a builtin or external module
                            // https://github.com/oven-sh/bun/issues/3764
                            if !other_source.is_valid() {
                                break;
                            }
                            redirect_count += 1;
                        }

                        let import_record = &self.all_import_records
                            [import_record_list_id.get() as usize]
                            .slice()[ir_idx];
                        // Mark if the file is imported by JS and its URL is inlined for CSS
                        let is_inlined = import_record.source_index.is_valid()
                            && !self.all_urls_for_css[import_record.source_index.get() as usize]
                                .is_empty();
                        if is_js && is_inlined {
                            self.additional_files_imported_by_js_and_inlined_in_css
                                .set(import_record.source_index.get() as usize);
                        } else if is_css && is_inlined {
                            self.additional_files_imported_by_css_and_inlined
                                .set(import_record.source_index.get() as usize);
                        }

                        let next_source = import_record.source_index;
                        let kind_is_dynamic = import_record.kind == ImportKind::Dynamic;
                        self.visit::<CHECK_DYNAMIC_IMPORTS>(
                            next_source,
                            CHECK_DYNAMIC_IMPORTS && kind_is_dynamic,
                        );
                    }
                }

                // Redirects replace the source file with another file
                if let Some(redirect_id) =
                    get_redirect_id(self.redirects[source_index.get() as usize])
                {
                    let redirect_source_index = self.all_import_records
                        [source_index.get() as usize]
                        .slice()[redirect_id as usize]
                        .source_index
                        .get();
                    self.visit::<CHECK_DYNAMIC_IMPORTS>(
                        Index::source(redirect_source_index),
                        was_dynamic_import,
                    );
                    return;
                }
            }

            // Each file must come after its dependencies
            self.reachable.push(source_index);
            if CHECK_DYNAMIC_IMPORTS {
                if was_dynamic_import {
                    self.dynamic_import_entry_points
                        .put(source_index.get(), ())
                        .expect("unreachable");
                }
            }
        }
    }

    /// RAII guard returned by [`BundleV2::decrement_scan_counter_on_drop`].
    /// Decrements the bundle's pending-scan counter when dropped, mirroring Zig's
    /// `defer this.decrementScanCounter()` without holding a unique borrow across
    /// the body. Stores a raw pointer; caller guarantees the `BundleV2` outlives it.
    pub struct ScanCounterGuard {
        bv2: *mut BundleV2<'static>,
    }

    impl Drop for ScanCounterGuard {
        fn drop(&mut self) {
            // SAFETY: constructed from `&mut BundleV2` in
            // `decrement_scan_counter_on_drop`; the guard is a local that drops at
            // scope exit while the `BundleV2` it points to is still alive. The
            // lifetime is erased to `'static` only for storage — never observed.
            unsafe { (*self.bv2).decrement_scan_counter() };
        }
    }

    impl<'a> BundleV2<'a> {
        #[cold]
        pub fn find_reachable_files(&mut self) -> Result<Box<[Index]>, Error> {
            // RAII guard — `Ctx` ends the span on Drop (Zig: `defer trace.end()`).
            let _trace = crate::ungate_support::perf::trace("Bundler.findReachableFiles");

            // Create a quick index for server-component boundaries.
            // We need to mark the generated files as reachable, or else many files will appear missing.
            // PERF(port): was stack-fallback
            let mut scb_bitset = if self.graph.server_component_boundaries.list.len() > 0 {
                Some(
                    self.graph
                        .server_component_boundaries
                        .slice()
                        .bit_set(self.graph.input_files.len())?,
                )
            } else {
                None
            };

            let mut additional_files_imported_by_js_and_inlined_in_css =
                DynamicBitSetUnmanaged::init_empty(self.graph.input_files.len())?;
            let mut additional_files_imported_by_css_and_inlined =
                DynamicBitSetUnmanaged::init_empty(self.graph.input_files.len())?;

            self.dynamic_import_entry_points = ArrayHashMap::new();

            // PORT NOTE: reshaped for borrowck — hoist the values that would
            // otherwise re-borrow `self`/`self.graph` while the visitor holds
            // disjoint column refs (Zig pulled multiple `items(.field)` columns at
            // once with no aliasing model).
            let redirect_map: *const PathToSourceIndexMap =
                std::ptr::from_ref(self.path_to_source_index_map(self.transpiler.options.target));
            // Always materialize a valid slice; when the boundary list is empty
            // this is a cheap `{ list: empty, map: &map }`. Avoids constructing a
            // null `&Map` via `mem::zeroed()` (UB even though it was never read
            // when `scb_bitset` is `None`).
            let scb_list = self.graph.server_component_boundaries.slice();

            // PORT NOTE: reshaped for borrowck — `Slice<T>` is a value-type
            // snapshot of column pointers (does not borrow `self.graph.ast`), so
            // `split_mut()` on the local can coexist with the shared borrows
            // below. The slab does not resize for the duration of this function.
            let mut ast_slice = self.graph.ast.slice();
            let all_import_records: &mut [import_record::List] =
                ast_slice.split_mut().import_records;
            let all_urls_for_css = self.graph.ast.items_url_for_css();

            let mut visitor = ReachableFileVisitor {
                reachable: Vec::with_capacity(self.graph.entry_points.len() + 1),
                visited: DynamicBitSet::init_empty(self.graph.input_files.len())?,
                redirects: self.graph.ast.items_redirect_import_record_index(),
                all_import_records,
                all_loaders: self.graph.input_files.items_loader(),
                all_urls_for_css,
                redirect_map,
                dynamic_import_entry_points: &mut self.dynamic_import_entry_points,
                scb_bitset,
                scb_list,
                additional_files_imported_by_js_and_inlined_in_css:
                    &mut additional_files_imported_by_js_and_inlined_in_css,
                additional_files_imported_by_css_and_inlined:
                    &mut additional_files_imported_by_css_and_inlined,
            };

            // If we don't include the runtime, __toESM or __toCommonJS will not get
            // imported and weird things will happen
            visitor.visit::<false>(Index::RUNTIME, false);

            if self.transpiler.options.code_splitting {
                for entry_point in self.graph.entry_points.iter().copied() {
                    visitor.visit::<true>(entry_point.into(), false);
                }
            } else {
                for entry_point in self.graph.entry_points.iter().copied() {
                    visitor.visit::<false>(entry_point.into(), false);
                }
            }

            if cfg!(debug_assertions) && ReachableFiles.is_visible() {
                bun_core::scoped_log!(
                    ReachableFiles,
                    "Reachable count: {} / {}",
                    visitor.reachable.len(),
                    self.graph.input_files.len()
                );
                let sources = self.graph.input_files.items_source();
                let targets = self.graph.ast.items_target();
                for idx in visitor.reachable.iter() {
                    let source = &sources[idx.get() as usize];
                    bun_core::scoped_log!(
                        ReachableFiles,
                        "reachable file: #{} {} ({}) target=.{}",
                        source.index.0,
                        bun_core::fmt::quote(&source.path.pretty),
                        bstr::BStr::new(&source.path.text),
                        <&'static str>::from(targets[idx.get() as usize]),
                    );
                }
            }

            // PORT NOTE: reshaped for borrowck — release the visitor's `&mut`
            // borrows on the two bitsets and `input_files` columns before the
            // cleanup loop reads them.
            let ReachableFileVisitor { reachable, .. } = visitor;

            // PORT NOTE: reshaped for borrowck — three disjoint mutable SoA
            // columns via `split_mut()` on a value-type `Slice` snapshot.
            let mut input_files_slice = self.graph.input_files.slice();
            let input_files_cols = input_files_slice.split_mut();
            let additional_files: &mut [Vec<crate::AdditionalFile>] =
                input_files_cols.additional_files;
            let unique_keys: &mut [Box<[u8]>] = input_files_cols.unique_key_for_additional_file;
            let content_hashes: &mut [u64] = input_files_cols.content_hash_for_additional_file;
            for (index, url_for_css) in all_urls_for_css.iter().enumerate() {
                if !url_for_css.is_empty() {
                    // We like to inline additional files in CSS if they fit a size threshold
                    // If we do inline a file in CSS, and it is not imported by JS, then we don't need to copy the additional file into the output directory
                    if additional_files_imported_by_css_and_inlined.is_set(index)
                        && !additional_files_imported_by_js_and_inlined_in_css.is_set(index)
                    {
                        additional_files[index].clear_retaining_capacity();
                        unique_keys[index] = b"".as_slice().into();
                        content_hashes[index] = 0;
                    }
                }
            }

            Ok(reachable.into_boxed_slice())
        }

        fn is_done(&mut self) -> bool {
            self.thread_lock.assert_locked();

            if self.graph.pending_items == 0 {
                // PORT NOTE: reshaped for borrowck — Zig passed `&self.graph` and
                // `self` to the same call. Take a raw ptr so the two `&mut` don't
                // overlap from rustc's view.
                // SAFETY: `drain_deferred_tasks` only touches `self.graph.deferred_*`
                // fields and the `BundleV2` callback surface; no aliasing UB.
                let this: *mut Self = self;
                if unsafe { (*this).graph.drain_deferred_tasks(&mut *this) } {
                    return false;
                }
                return true;
            }

            false
        }

        #[cold]
        pub fn wait_for_parse(&mut self) {
            // bundle_v2.zig:488-491 — `this.loop().tick(this, &isDone)`.
            //
            // PORT NOTE: `tick_raw` (not `tick`) — `is_done` reborrows `*ctx` as
            // `&mut BundleV2`, and `BundleV2` (via `linker.r#loop`) owns the
            // `AnyEventLoop` slot, so holding `&mut AnyEventLoop` across the
            // callback would be a Stacked-Borrows violation.
            let self_ptr: *mut Self = self;
            let any_loop = self
                .r#loop()
                .expect("event loop not initialized for waitForParse")
                .as_ptr();
            // SAFETY: `any_loop` points into `self.linker.r#loop`, valid for the
            // duration of this call; `self_ptr` is the live `&mut self`. The
            // callback's `'static` lifetime erasure mirrors the Zig
            // `*anyopaque` cast — `is_done` only touches by-value fields.
            unsafe {
                bun_event_loop::AnyEventLoop::tick_raw(any_loop, self_ptr.cast(), |ctx| {
                    (*ctx.cast::<BundleV2<'static>>()).is_done()
                });
            }
            bun_core::scoped_log!(
                Bundle,
                "Parsed {} files, producing {} ASTs",
                self.graph.input_files.len(),
                self.graph.ast.len()
            );
        }

        /// `BUN_THREADPOOL_STATS=1` instrumentation hook — dump aggregate worker
        /// idle/busy time since the previous call. No-op when env var unset.
        #[inline]
        pub fn dump_pool_stats(&self, label: &str) {
            self.graph.pool().worker_pool().dump_stats(label);
        }

        #[cold]
        pub fn scan_for_secondary_paths(&mut self) {
            if !self.graph.has_any_secondary_paths {
                // Assert the boolean is accurate.
                #[cfg(debug_assertions)]
                for secondary_path in self.graph.input_files.items_secondary_path() {
                    if !secondary_path.is_empty() {
                        panic!("secondary_path is not empty");
                    }
                }
                // No dual package hazard. Do nothing.
                return;
            }

            // Now that all files have been scanned, look for packages that are imported
            // both with "import" and "require". Rewrite any imports that reference the
            // "module" package.json field to the "main" package.json field instead.
            //
            // This attempts to automatically avoid the "dual package hazard" where a
            // package has both a CommonJS module version and an ECMAScript module
            // version and exports a non-object in CommonJS (often a function). If we
            // pick the "module" field and the package is imported with "require" then
            // code expecting a function will crash.
            //
            // PORT NOTE: reshaped for borrowck — Zig pulled the mutable
            // `import_records` column alongside shared columns. `split_mut()` on a
            // value-type `Slice` snapshot yields the one mutable column without
            // borrowing `self.graph.ast`; read the per-target map through the
            // disjoint `build_graphs` field instead of the `&mut self` accessor.
            let mut ast_slice = self.graph.ast.slice();
            let ast_import_records: &mut [import_record::List] =
                ast_slice.split_mut().import_records;
            let targets = self.graph.ast.items_target();
            let max_valid_source_index = Index::init(self.graph.input_files.len());
            let secondary_paths = self.graph.input_files.items_secondary_path();
            let sources = self.graph.input_files.items_source();

            debug_assert_eq!(ast_import_records.len(), targets.len());
            for (ast_import_record_list, target) in
                ast_import_records.iter_mut().zip(targets.iter())
            {
                let import_records = ast_import_record_list.slice_mut();
                let path_to_source_index_map = &self.graph.build_graphs[*target];
                for import_record in import_records.iter_mut() {
                    let source_index = import_record.source_index.get();
                    if source_index >= max_valid_source_index.get() {
                        continue;
                    }
                    let secondary_path: &[u8] = &secondary_paths[source_index as usize];
                    if !secondary_path.is_empty() {
                        let Some(secondary_source_index) =
                            path_to_source_index_map.get(secondary_path)
                        else {
                            continue;
                        };
                        import_record.source_index = Index::init(secondary_source_index);
                        // Keep path in sync for determinism, diagnostics, and dev tooling.
                        import_record.path = sources[secondary_source_index as usize].path.clone();
                    }
                }
            }
        }

        /// This runs on the Bundle Thread.
        #[cold]
        pub fn run_resolver(
            &mut self,
            import_record: jsc_api::JSBundler::MiniImportRecord,
            target: options::Target,
        ) {
            // PORT NOTE: reshaped for borrowck — Zig held a `*Transpiler` raw pointer alongside
            // other `this.*` accesses. `transpiler_for_target` borrows `&mut self`, so launder
            // through a raw pointer to keep `*self` available below.
            // SAFETY: the returned `&mut Transpiler` lives for `'a` (set in `init`), is not
            // invalidated by anything called here, and Zig aliased it identically.
            let transpiler: *mut Transpiler<'a> = self.transpiler_for_target(target);
            let source_dir =
                Fs::PathName::init(&import_record.source_file).dir_with_trailing_slash();

            // Check the FileMap first for in-memory files
            if let Some(file_map) = self.file_map {
                if let Some(_file_map_result) = file_map.resolve(
                    self.arena(),
                    &import_record.source_file,
                    &import_record.specifier,
                ) {
                    let mut file_map_result = _file_map_result;
                    let mut path_primary = file_map_result.path_pair.primary.clone();
                    // PORT NOTE: reshaped for borrowck — `get_or_put` borrows `*self` mutably via
                    // `self.graph`; capture the slot as `*mut u32` so subsequent `self.*` calls
                    // type-check. SAFETY: `path_to_source_index_map(target)` is not mutated again
                    // until after the last `*value_ptr` access below.
                    let (found_existing, value_ptr): (bool, *mut u32) = {
                        let entry = self
                            .path_to_source_index_map(target)
                            .get_or_put(&path_primary.text)
                            .expect("oom");
                        (
                            entry.found_existing,
                            std::ptr::from_mut::<u32>(entry.value_ptr),
                        )
                    };
                    if !found_existing {
                        let loader: Loader = 'brk: {
                            let record: &mut ImportRecord =
                                &mut self.graph.ast.items_import_records_mut()
                                    [import_record.importer_source_index as usize]
                                    .slice_mut()
                                    [import_record.import_record_index as usize];
                            if let Some(out_loader) = record.loader {
                                break 'brk out_loader;
                            }
                            // SAFETY: see `transpiler` note above.
                            break 'brk Fs::Path::init(path_primary.text)
                                .loader(unsafe { &(*transpiler).options.loaders })
                                .unwrap_or(Loader::File);
                        };
                        // For virtual files, use the path text as-is (no relative path computation needed).
                        path_primary.pretty = self.arena().alloc_slice_copy(&path_primary.text);
                        let mut tmp_source = bun_ast::Source {
                            path: path_as_static(path_primary),
                            contents: std::borrow::Cow::Borrowed(&b""[..]),
                            ..Default::default()
                        };
                        let idx = self
                            .enqueue_parse_task(
                                &file_map_result,
                                &mut tmp_source,
                                loader,
                                import_record.original_target,
                            )
                            .expect("oom");
                        // SAFETY: see `value_ptr` note above.
                        unsafe { *value_ptr = idx };
                        let record: &mut ImportRecord =
                            &mut self.graph.ast.items_import_records_mut()
                                [import_record.importer_source_index as usize]
                                .slice_mut()
                                [import_record.import_record_index as usize];
                        record.source_index = Index::init(idx);
                    } else {
                        let record: &mut ImportRecord =
                            &mut self.graph.ast.items_import_records_mut()
                                [import_record.importer_source_index as usize]
                                .slice_mut()
                                [import_record.import_record_index as usize];
                        // SAFETY: see `value_ptr` note above.
                        record.source_index = Index::init(unsafe { *value_ptr });
                    }
                    return;
                }
            }

            let mut had_busted_dir_cache = false;
            let resolve_result: _resolver::Result = loop {
                // SAFETY: see `transpiler` note above.
                match unsafe { &mut *transpiler }.resolver.resolve(
                    source_dir,
                    &import_record.specifier,
                    import_record.kind,
                ) {
                    Ok(r) => break r,
                    Err(err) => {
                        // Only perform directory busting when hot-reloading is enabled
                        if err == bun_core::err!("ModuleNotFound") {
                            if let Some(dev) = &self.dev_server {
                                if !had_busted_dir_cache {
                                    // Only re-query if we previously had something cached.
                                    // SAFETY: see `transpiler` note above.
                                    if unsafe { &mut *transpiler }
                                        .resolver
                                        .bust_dir_cache_from_specifier(
                                            &import_record.source_file,
                                            &import_record.specifier,
                                        )
                                    {
                                        had_busted_dir_cache = true;
                                        continue;
                                    }
                                }

                                // Tell Bake's Dev Server to wait for the file to be imported.
                                dev.track_resolution_failure(
                                    &import_record.source_file,
                                    &import_record.specifier,
                                    target.bake_graph(),
                                    self.graph.input_files.items_loader()
                                        [import_record.importer_source_index as usize],
                                )
                                .expect("oom");

                                // Turn this into an invalid AST, so that incremental mode skips it when printing.
                                unsafe {
                                    self.graph.ast.items_parts_mut()
                                        [import_record.importer_source_index as usize]
                                        .set_len((0) as usize)
                                };
                            }
                        }

                        let handles_import_errors;
                        let source: Option<&bun_ast::Source>;
                        // PORT NOTE: reshaped for borrowck — `log_for_resolution_failures` borrows
                        // `&mut self`; the returned log is backed by either a DevServer-owned slot or
                        // `*self.transpiler.log` (both raw-pointer-derived), so detach the lifetime
                        // so `self.graph.*` / `self.transpiler.*` reads below type-check.
                        // SAFETY: log lives in DevServer / transpiler, disjoint from `self.graph`.
                        let log: &mut bun_ast::Log = unsafe {
                            bun_ptr::detach_lifetime_mut(self.log_for_resolution_failures(
                                &import_record.source_file,
                                target.bake_graph(),
                            ))
                        };

                        {
                            let record: &mut ImportRecord =
                                &mut self.graph.ast.items_import_records_mut()
                                    [import_record.importer_source_index as usize]
                                    .slice_mut()
                                    [import_record.import_record_index as usize];
                            handles_import_errors = record
                                .flags
                                .contains(bun_ast::ImportRecordFlags::HANDLES_IMPORT_ERRORS);

                            // Disable failing packages from being printed.
                            // This may cause broken code to write.
                            // However, doing this means we tell them all the resolve errors
                            // Rather than just the first one.
                            record.path.is_disabled = true;
                        }
                        source = Some(
                            &self.graph.input_files.items_source()
                                [import_record.importer_source_index as usize],
                        );

                        if err == bun_core::err!("ModuleNotFound") {
                            let add_error = bun_ast::Log::add_resolve_error_with_text_dupe;
                            let path_to_use = &import_record.specifier;

                            if !handles_import_errors
                                && !self.transpiler.options.ignore_module_resolution_errors
                            {
                                if is_package_path(&import_record.specifier) {
                                    if target == Target::Browser
                                        && options::is_node_builtin(path_to_use)
                                    {
                                        add_error(
                                            log,
                                            source,
                                            import_record.range,
                                            format_args!(
                                                "Browser build cannot {} Node.js module: \"{}\". To use Node.js builtins, set target to 'node' or 'bun'",
                                                bstr::BStr::new(import_record.kind.error_label()),
                                                bstr::BStr::new(path_to_use)
                                            ),
                                            path_to_use,
                                            import_record.kind.into(),
                                        );
                                    } else {
                                        add_error(
                                            log,
                                            source,
                                            import_record.range,
                                            format_args!(
                                                "Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                                                bstr::BStr::new(path_to_use)
                                            ),
                                            path_to_use,
                                            import_record.kind.into(),
                                        );
                                    }
                                } else {
                                    add_error(
                                        log,
                                        source,
                                        import_record.range,
                                        format_args!(
                                            "Could not resolve: \"{}\"",
                                            bstr::BStr::new(path_to_use)
                                        ),
                                        path_to_use,
                                        import_record.kind.into(),
                                    );
                                }
                            }
                        }
                        // assume other errors are already in the log
                        return;
                    }
                }
            };
            let mut resolve_result = resolve_result;

            let mut out_source_index: Option<Index> = None;

            // PORT NOTE(borrowck): Zig held a `*Fs.Path` into `resolve_result` while
            // also reading other fields and re-borrowing `self`. Rust borrowck rejects
            // that, so we clone the active path out and operate on an owned value.
            let mut path: Fs::Path<'static> = match resolve_result.path() {
                Some(p) => p.clone(),
                None => {
                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()
                        [import_record.importer_source_index as usize]
                        .slice_mut()[import_record.import_record_index as usize];
                    // Disable failing packages from being printed.
                    // This may cause broken code to write.
                    // However, doing this means we tell them all the resolve errors
                    // Rather than just the first one.
                    record.path.is_disabled = true;
                    return;
                }
            };

            if resolve_result.flags.is_external() {
                return;
            }

            if path.pretty.as_ptr() == path.text.as_ptr() {
                // TODO: outbase
                let rel = bun_paths::resolve_path::relative_platform::<
                    bun_paths::resolve_path::platform::Loose,
                    false,
                >(
                    bun_resolver::fs::FileSystem::get().top_level_dir,
                    &path.text,
                );
                // SAFETY: arena outlives the bundle pass; raw-pointer detour erases the
                // `&self` lifetime so the resulting `&'static [u8]` doesn't pin `self`.
                path.pretty =
                    unsafe { bun_ptr::detach_lifetime(self.arena().alloc_slice_copy(rel)) };
            }
            path.assert_pretty_is_valid();
            path.assert_file_path_is_absolute();

            // PORT NOTE(borrowck): split Zig's `getOrPut` into get-then-put so the map
            // borrow doesn't span `enqueue_parse_task` (which needs `&mut self`).
            if let Some(existing) = self.path_to_source_index_map(target).get(&path.text) {
                out_source_index = Some(Index::init(existing));
            } else {
                path = self
                    .path_with_pretty_initialized(path, target)
                    .expect("oom");
                // PORT NOTE: Zig wrote through `path.* = …` (a `*Fs.Path` into
                // `resolve_result.path_pair`); the borrowck-reshape above cloned
                // `path` out, so write the prettified path back so
                // `ParseTask::init(&resolve_result, ..)` (via `enqueue_parse_task`)
                // sees the relativized `pretty`.
                if let Some(p) = resolve_result.path() {
                    *p = path.clone();
                }
                let loader: Loader = 'brk: {
                    let record: &ImportRecord = &self.graph.ast.items_import_records()
                        [import_record.importer_source_index as usize]
                        .slice()[import_record.import_record_index as usize];
                    if let Some(out_loader) = record.loader {
                        break 'brk out_loader;
                    }
                    // SAFETY: see `transpiler` note above.
                    break 'brk path
                        .loader(unsafe { &(*transpiler).options.loaders })
                        .unwrap_or(Loader::File);
                    // HTML is only allowed at the entry point.
                };
                let mut tmp_source = bun_ast::Source {
                    path: path_as_static(path.dupe_alloc().expect("oom")),
                    contents: std::borrow::Cow::Borrowed(&b""[..]),
                    ..Default::default()
                };
                let idx = self
                    .enqueue_parse_task(
                        &resolve_result,
                        &mut tmp_source,
                        loader,
                        import_record.original_target,
                    )
                    .expect("oom");
                self.path_to_source_index_map(target)
                    .put(&path.text, idx)
                    .expect("oom");
                out_source_index = Some(Index::init(idx));

                if let Some(secondary) = &resolve_result.path_pair.secondary {
                    if !secondary.is_disabled
                        && !strings::eql_long(&secondary.text, &path.text, true)
                    {
                        let secondary_path_to_copy = secondary.dupe_alloc().expect("oom");
                        self.graph.input_files.items_secondary_path_mut()[idx as usize] =
                            secondary_path_to_copy.text.into();
                        // Ensure the determinism pass runs.
                        self.graph.has_any_secondary_paths = true;
                    }
                }

                // For non-javascript files, make all of these files share indices.
                // For example, it is silly to bundle index.css depended on by client+server twice.
                // It makes sense to separate these for JS because the target affects DCE
                if self.transpiler.options.server_components && !loader.is_javascript_like() {
                    // PORT NOTE: reshaped for borrowck — cannot hold two `&mut` into
                    // `self.graph` simultaneously, so re-derive the map per insert.
                    let key_text: Box<[u8]> = path.text.to_vec().into_boxed_slice();
                    let main_target = self.transpiler.options.target;
                    let separate_ssr = self
                        .framework
                        .as_ref()
                        .unwrap()
                        .server_components
                        .as_ref()
                        .unwrap()
                        .separate_ssr_graph;
                    let (ta, tb) = match target {
                        Target::Browser => (main_target, Target::BakeServerComponentsSsr),
                        Target::BakeServerComponentsSsr => (main_target, Target::Browser),
                        _ => (Target::Browser, Target::BakeServerComponentsSsr),
                    };
                    self.path_to_source_index_map(ta)
                        .put(&key_text, idx)
                        .expect("oom");
                    if separate_ssr {
                        self.path_to_source_index_map(tb)
                            .put(&key_text, idx)
                            .expect("oom");
                    }
                }
            }

            if let Some(source_index) = out_source_index {
                let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()
                    [import_record.importer_source_index as usize]
                    .slice_mut()[import_record.import_record_index as usize];
                record.source_index = source_index;
            }
        }

        #[cold]
        pub fn enqueue_file_from_dev_server_incremental_graph_invalidation(
            &mut self,
            path_slice: &[u8],
            target: options::Target,
        ) -> Result<(), Error> {
            // TODO: plugins with non-file namespaces
            // PORT NOTE(borrowck): split Zig's `getOrPut` into get-then-put so the map
            // borrow doesn't span the resolver / `&mut self` calls below.
            if self
                .path_to_source_index_map(target)
                .get(path_slice)
                .is_some()
            {
                return Ok(());
            }
            let mut result = match self
                .transpiler_for_target(target)
                .resolve_entry_point(path_slice)
            {
                Ok(r) => r,
                Err(_) => return Ok(()),
            };
            let mut path = result.path_pair.primary.clone();
            self.increment_scan_counter();
            let source_index = Index::source(self.graph.input_files.len() as u32);
            let loader = path
                .loader(&self.transpiler.options.loaders)
                .unwrap_or(Loader::File);

            path = self.path_with_pretty_initialized(path, target)?;
            path.assert_pretty_is_valid();
            // PORT NOTE: see `enqueue_entry_item` — write the prettified path back
            // into `result` so `ParseTask::init(&result, ..)` reads the relativized
            // `pretty` (Zig mutated `result.path_pair.primary` in place via `path.*`).
            result.path_pair.primary = path.clone();
            self.path_to_source_index_map(target)
                .put(path_slice, source_index.get())
                .expect("oom");
            let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

            self.graph.input_files.append(crate::Graph::InputFile {
                source: bun_ast::Source {
                    path: path_as_static(path),
                    contents: std::borrow::Cow::Borrowed(&b""[..]),
                    index: bun_ast::Index(source_index.get()),
                    ..Default::default()
                },
                loader,
                side_effects: result.primary_side_effects_data,
                ..Default::default()
            })?;
            // Arena-owned (Zig: `arena.create(ParseTask)`); freed on heap reset.
            let task_val = ParseTask::init(&result, source_index.into(), self);
            // SAFETY: arena outlives the bundle pass; reborrow `*mut` as `&mut`.
            let task: &mut ParseTask = self.arena_create(task_val);
            task.loader = Some(loader);
            task.task.node.next = core::ptr::null_mut();
            task.tree_shaking = self.linker.options.tree_shaking;
            task.known_target = target;
            {
                let t = self.transpiler_for_target(target);
                task.jsx.development = match t.options.force_node_env {
                    options::ForceNodeEnv::Development => true,
                    options::ForceNodeEnv::Production => false,
                    options::ForceNodeEnv::Unspecified => t.options.jsx.development,
                };
            }

            // Handle onLoad plugins as entry points
            if !self.enqueue_on_load_plugin_if_needed(task) {
                if loader.should_copy_for_bundling() {
                    let additional_files: &mut Vec<crate::AdditionalFile> =
                        &mut self.graph.input_files.items_additional_files_mut()
                            [source_index.get() as usize];
                    additional_files
                        .push(crate::AdditionalFile::SourceIndex(task.source_index.get()));
                    self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] =
                        bun_ast::SideEffects::NoSideEffectsPureData;
                    self.graph.estimated_file_loader_count += 1;
                }

                self.graph.pool().schedule(task);
            }
            Ok(())
        }

        #[cold]
        pub fn enqueue_entry_item(
            &mut self,
            resolve: &mut _resolver::Result,
            is_entry_point: bool,
            target: options::Target,
        ) -> Result<Option<IndexInt>, Error> {
            let result = &mut *resolve;
            // PORT NOTE(borrowck): clone the active path out so we don't hold a `&mut`
            // into `result` across the `&mut self` calls below.
            let mut path: Fs::Path<'static> = match result.path() {
                Some(p) => p.clone(),
                None => return Ok(None),
            };

            path.assert_file_path_is_absolute();
            // PORT NOTE(borrowck): split Zig's `getOrPut` into get-then-put.
            if self
                .path_to_source_index_map(target)
                .get(&path.text)
                .is_some()
            {
                return Ok(None);
            }
            self.increment_scan_counter();
            let source_index = Index::source(self.graph.input_files.len() as u32);

            let loader = path
                .loader(&self.transpiler.options.loaders)
                .unwrap_or(Loader::File);

            // SAFETY: `path_with_pretty_initialized` allocates into `self.graph.heap`, which
            // outlives the bundle pass; erase the arena lifetime back to the resolver's
            // `Path<'static>` alias so `path` doesn't keep `self` borrowed.
            path = unsafe {
                self.path_with_pretty_initialized(path, target)?
                    .into_static()
            };
            path.assert_pretty_is_valid();
            // PORT NOTE: intern via `dupe_alloc` BEFORE writing back into `result` /
            // the path-to-source-index map. Zig didn't need this — its dev-server
            // `EntryPointList` keys borrow `dev.server_graph.bundled_files.keys()`
            // (DevServer-owned), and `genericPathWithPrettyInitialized` returns the
            // input `Path` unchanged for `node`-namespace built-ins (e.g.
            // `bun-framework-react/server.tsx`), so `path.text` stayed a borrow of
            // long-lived storage. The Rust port rebuilds a fresh
            // `bake_types::EntryPointList` with `Box<[u8]>` keys (DevServer.rs:3027)
            // that drops as soon as `enqueue_entry_points_dev_server` returns;
            // `resolve_with_framework` then lifetime-erases that key into the
            // returned `Path`, so without interning here `ParseTask.path.text` (and
            // the map key) would dangle once the entry-point list is freed —
            // surfacing as "Failed to load bundled module
            // 'bun-framework-react/server.tsx'" when the worker can no longer match
            // `built_in_modules`.
            path = path.dupe_alloc().expect("oom");
            // PORT NOTE: Zig's `var path = result.path()` is a `*Fs.Path` *into*
            // `result.path_pair`, so the `path.* = pathWithPrettyInitialized(...)`
            // assignment mutates the resolver result in place. The borrowck-reshape
            // above cloned `path` out, which left `result.path_pair` with the
            // unrelativized `pretty` — and `ParseTask::init(&result, ..)` reads
            // exactly that field, so the source comment header lost its
            // `top_level_dir`-relative path. Write the prettified path back here.
            if let Some(p) = result.path() {
                *p = path.clone();
            }
            self.path_to_source_index_map(target)
                .put(&path.text, source_index.get())
                .expect("oom");
            let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

            let side_effects = result.primary_side_effects_data;
            self.graph.input_files.append(crate::Graph::InputFile {
                source: bun_ast::Source {
                    path: path_as_static(path.clone()),
                    contents: std::borrow::Cow::Borrowed(&b""[..]),
                    index: bun_ast::Index(source_index.get()),
                    ..Default::default()
                },
                loader,
                side_effects,
                ..Default::default()
            })?;
            // Arena-owned (Zig: `arena.create(ParseTask)`); freed on heap reset.
            let task_val = ParseTask::init(result, source_index.into(), self);
            // SAFETY: arena outlives the bundle pass; reborrow `*mut` as `&mut`.
            let task: &mut ParseTask = self.arena_create(task_val);
            task.loader = Some(loader);
            task.task.node.next = core::ptr::null_mut();
            task.tree_shaking = self.linker.options.tree_shaking;
            task.is_entry_point = is_entry_point;
            task.known_target = target;
            {
                let bundler = self.transpiler_for_target(target);
                task.jsx.development = match bundler.options.force_node_env {
                    options::ForceNodeEnv::Development => true,
                    options::ForceNodeEnv::Production => false,
                    options::ForceNodeEnv::Unspecified => bundler.options.jsx.development,
                };
            }

            // Handle onLoad plugins as entry points
            if !self.enqueue_on_load_plugin_if_needed(task) {
                if loader.should_copy_for_bundling() {
                    let additional_files: &mut Vec<crate::AdditionalFile> =
                        &mut self.graph.input_files.items_additional_files_mut()
                            [source_index.get() as usize];
                    additional_files
                        .push(crate::AdditionalFile::SourceIndex(task.source_index.get()));
                    self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] =
                        bun_ast::SideEffects::NoSideEffectsPureData;
                    self.graph.estimated_file_loader_count += 1;
                }

                self.graph.pool().schedule(task);
            }

            self.graph
                .entry_points
                .push(bun_ast::Index::init(source_index.get()));

            Ok(Some(source_index.get()))
        }

        /// `heap` is not freed when `deinit`ing the BundleV2
        pub fn init(
            transpiler: &'a mut Transpiler<'a>,
            bake_options: Option<BakeOptions<'a>>,
            alloc: &bun_alloc::Arena,
            event_loop: EventLoop,
            cli_watch_flag: bool,
            // Raw `NonNull` (not `&mut`): the JS-API path threads `WorkPool::get()`
            // (a `&'static` from `OnceLock`, concurrently read by workers) through
            // here into `ThreadPool::init`, which stores it as `*mut`. Creating a
            // `&mut` along the way would violate Stacked Borrows.
            thread_pool: Option<NonNull<ThreadPoolLib>>,
            heap: ThreadLocalArena,
        ) -> Result<Box<BundleV2<'a>>, Error> {
            // TODO(port): arena-allocate self via bump.alloc — Box::new is wrong arena (Zig: arena.create(@This()) on arena)
            transpiler.env().load_tracy();

            transpiler.options.mark_builtins_as_external =
                transpiler.options.target.is_bun() || transpiler.options.target == Target::Node;
            transpiler.resolver.opts.mark_builtins_as_external =
                transpiler.options.target.is_bun() || transpiler.options.target == Target::Node;

            // SAFETY: aliased *mut for `ssr_transpiler` (Zig stored both as raw ptrs).
            let ssr_alias: *mut Transpiler<'a> = std::ptr::from_mut(transpiler);
            let mut this = Box::new(BundleV2 {
                transpiler,
                client_transpiler: None,
                owned_client_transpiler: None,
                ssr_transpiler: ssr_alias,
                framework: None,
                graph: Graph {
                    pool: bun_ptr::BackRef::from(NonNull::<ThreadPool>::dangling()), // set below
                    heap,
                    kit_referenced_server_data: false,
                    kit_referenced_client_data: false,
                    ..Default::default()
                },
                linker: LinkerContext {
                    r#loop: event_loop,
                    graph: LinkerGraph::default(),
                    ..Default::default()
                },
                bun_watcher: None,
                plugins: None,
                completion: None,
                dev_server: None,
                file_map: None,
                source_code_length: 0,
                thread_lock: bun_core::ThreadLock::init_locked(),
                resolve_tasks_waiting_for_import_source_index: ArrayHashMap::new(),
                free_list: Vec::new(),
                unique_key: 0,
                dynamic_import_entry_points: ArrayHashMap::new(),
                has_on_parse_plugins: false,
                finalizers: Vec::new(),
                drain_defer_task: DeferredBatchTask::default(),
                asynchronous: false,
                has_any_top_level_await_modules: false,
                requested_exports: ArrayHashMap::new(),
            });
            if let Some(bo) = bake_options {
                this.client_transpiler = Some(bo.client_transpiler.into());
                this.ssr_transpiler = bo.ssr_transpiler.as_ptr();
                let separate_ssr = bo
                    .framework
                    .server_components
                    .as_ref()
                    .map(|sc| sc.separate_ssr_graph)
                    .unwrap_or(false);
                this.framework = Some(bo.framework);
                this.linker.framework = this.framework.as_ref().map(bun_ptr::BackRef::new);
                this.plugins = bo.plugins;
                if this.transpiler.options.server_components {
                    debug_assert!(
                        this.client_transpiler_ref()
                            .unwrap()
                            .options
                            .server_components
                    );
                    if separate_ssr {
                        debug_assert!(unsafe { (*this.ssr_transpiler).options.server_components });
                    }
                }
            }
            // PORT NOTE: Zig wired `heap.arena()` into `transpiler.arena` /
            // `resolver.arena` / `linker.arena` / `log.msgs.arena`. The
            // Rust `Transpiler<'a>`/`Resolver<'a>` store `&'a Arena` and `Log.msgs`
            // is a `Vec` (global alloc), so only `linker.graph.bump` needs the
            // backref into the now-stable `this.graph.heap` slot.
            this.linker.graph.bump = bun_ptr::BackRef::new(&this.graph.heap);
            this.transpiler.log_mut().clone_line_text = true;

            // We don't expose an option to disable this. Bake forbids tree-shaking
            // since every export must is always exist in case a future module
            // starts depending on it.
            if this.transpiler.options.output_format == options::Format::InternalBakeDev {
                this.transpiler.options.tree_shaking = false;
                this.transpiler.resolver.opts.tree_shaking = false;
            } else {
                this.transpiler.options.tree_shaking = true;
                this.transpiler.resolver.opts.tree_shaking = true;
            }

            // BACKREF: `LinkerContext<'a>.resolver` is `ParentRef<Resolver<'a>>`;
            // the resolver lives in `transpiler` which outlives `self` (same `'a`).
            this.linker.resolver = Some(bun_ptr::ParentRef::new(&this.transpiler.resolver));
            this.linker.graph.code_splitting = this.transpiler.options.code_splitting;

            this.linker.options.minify_syntax = this.transpiler.options.minify_syntax;
            this.linker.options.minify_identifiers = this.transpiler.options.minify_identifiers;
            this.linker.options.minify_whitespace = this.transpiler.options.minify_whitespace;
            this.linker.options.emit_dce_annotations = this.transpiler.options.emit_dce_annotations;
            this.linker.options.ignore_dce_annotations =
                this.transpiler.options.ignore_dce_annotations;
            // SAFETY: `transpiler.options.{banner,footer,public_path,metafile_*}` are
            // owned by the `'a`-lifetime `Transpiler` which outlives `this.linker`;
            // `LinkerOptions` stores `&'static [u8]` as a Phase-A lifetime erasure
            // (see `interned_slice` contract — these are bundle-pass-interned).
            this.linker.options.banner = unsafe { interned_slice(&this.transpiler.options.banner) };
            this.linker.options.footer = unsafe { interned_slice(&this.transpiler.options.footer) };
            this.linker.options.css_chunking = this.transpiler.options.css_chunking;
            this.linker.options.compile_to_standalone_html =
                this.transpiler.options.compile_to_standalone_html;
            this.linker.options.source_maps = this.transpiler.options.source_map;
            this.linker.options.tree_shaking = this.transpiler.options.tree_shaking;
            this.linker.options.public_path =
                unsafe { interned_slice(&this.transpiler.options.public_path) };
            this.linker.options.target = this.transpiler.options.target;
            this.linker.options.output_format = this.transpiler.options.output_format;
            this.linker.options.generate_bytecode_cache = this.transpiler.options.bytecode;
            this.linker.options.compile = this.transpiler.options.compile;
            this.linker.options.metafile = this.transpiler.options.metafile;
            this.linker.options.metafile_json_path =
                unsafe { interned_slice(&this.transpiler.options.metafile_json_path) };
            this.linker.options.metafile_markdown_path =
                unsafe { interned_slice(&this.transpiler.options.metafile_markdown_path) };

            this.linker.dev_server = this.dev_server;

            // Arena-owned (Zig: `arena.create(ThreadPool)`). Coerce to `*mut`
            // immediately so the `&this` borrow from `arena()` ends before
            // `ThreadPool::init` takes `&mut this`.
            let pool: *mut ThreadPool =
                std::ptr::from_mut(this.arena().alloc(ThreadPool::default()));
            if cli_watch_flag {
                // CYCLEBREAK GENUINE: hot_reloader is T6; runtime constructs the
                // `dispatch::WatcherHandle` (erased owner + `&'static WatcherVTable`)
                // via this extern hook and writes `bun_watcher` (Zig:
                // `Watcher.enableHotModuleReloading(this, null)` — bundle_v2.zig:994).
                dispatch::enable_hot_module_reloading_for_bundler(core::ptr::from_mut(&mut *this));
            }
            // errdefer this.graph.heap.deinit() — Drop handles arena teardown.

            // SAFETY: arena slot is live for the bundle pass; the default value
            // written above has no Drop, so overwriting via `*pool = ...` is fine.
            unsafe {
                *pool = ThreadPool::init(&mut *this, thread_pool)?;
            }
            this.graph.pool =
                bun_ptr::BackRef::from(NonNull::new(pool).expect("arena allocation is non-null"));
            // `Graph::pool` wraps the `BackRef` deref; `start()` takes `&self`.
            this.graph.pool().start();
            Ok(this)
        }

        pub fn arena(&self) -> &bun_alloc::Arena {
            &self.graph.heap
        }

        /// Allocate `value` into the bundler's arena (`self.graph.heap`) and return
        /// a `&'r mut T` whose lifetime is decoupled from `&self`. Mirrors Zig
        /// `arena.create(T)` — the arena owns the slab and reclaims it on
        /// `deinit_without_freeing_arena` / `heap.reset()`. The unbounded `'r`
        /// releases the `&self` borrow at the call site so callers can immediately
        /// reborrow `&mut self` (PORTING.md §Allocators: `bump.alloc(init)` →
        /// `&'bump mut T`).
        ///
        /// SAFETY (encapsulated): the arena slab is pinned and outlives every
        /// `&mut T` handed out here (freed only at `heap.reset()` after all
        /// callers are done); each call returns a fresh disjoint slot, so the
        /// resulting `&mut T` is unique.
        #[inline]
        #[allow(clippy::mut_from_ref)]
        fn arena_create<'r, T>(&self, value: T) -> &'r mut T {
            // SAFETY: arena slot is fresh + pinned for the bundle pass; see fn doc.
            unsafe { bun_ptr::detach_lifetime_mut(self.arena().alloc(value)) }
        }

        pub fn increment_scan_counter(&mut self) {
            self.thread_lock.assert_locked();
            self.graph.pending_items += 1;
            bun_core::scoped_log!(
                scan_counter,
                ".pending_items + 1 = {}",
                self.graph.pending_items
            );
        }

        pub fn decrement_scan_counter(&mut self) {
            self.thread_lock.assert_locked();
            self.graph.pending_items -= 1;
            bun_core::scoped_log!(
                scan_counter,
                ".pending_items - 1 = {}",
                self.graph.pending_items
            );
            self.on_after_decrement_scan_counter();
        }

        pub fn on_after_decrement_scan_counter(&mut self) {
            if self.asynchronous && self.is_done() {
                let dev = self
                    .dev_server
                    .unwrap_or_else(|| panic!("No dev server attached in asynchronous bundle job"));
                self.finish_from_bake_dev_server(&dev).expect("oom");
            }
        }

        /// RAII form of Zig's `defer this.decrementScanCounter()`. Captures `self` as
        /// a raw pointer so the returned guard does not hold a `&mut` borrow for the
        /// rest of the scope; the caller must ensure `self` outlives the guard.
        pub fn decrement_scan_counter_on_drop(&mut self) -> ScanCounterGuard {
            ScanCounterGuard {
                bv2: std::ptr::from_mut::<BundleV2<'a>>(self).cast::<BundleV2<'static>>(),
            }
        }

        // PORT NOTE: split because data type varies by variant — cannot express `switch(variant)`-typed param with const-generic enum on stable
        // TODO(port): comptime variant enum param + dependent data type — split into three monomorphic fns
        #[cold]
        pub fn enqueue_entry_points_normal<P: AsRef<[u8]>>(
            &mut self,
            data: &[P],
        ) -> Result<(), Error> {
            self.enqueue_entry_points_common()?;
            // (variant != .dev_server)
            self.reserve_source_indexes_for_bake()?;

            // Setup entry points
            let num_entry_points = data.len();
            self.graph.entry_points.reserve(num_entry_points);
            self.graph
                .input_files
                .ensure_unused_capacity(num_entry_points)?;

            for entry_point in data {
                let entry_point: &[u8] = entry_point.as_ref();
                if self.enqueue_entry_point_on_resolve_plugin_if_needed(
                    entry_point,
                    self.transpiler.options.target,
                ) {
                    continue;
                }

                // Check FileMap first for in-memory entry points
                if let Some(file_map) = self.file_map {
                    if let Some(file_map_result) = file_map.resolve(self.arena(), b"", entry_point)
                    {
                        let _ = self.enqueue_entry_item(
                            &mut { file_map_result },
                            true,
                            self.transpiler.options.target,
                        )?;
                        continue;
                    }
                }

                // no plugins were matched
                let mut resolved = match self.transpiler.resolve_entry_point(entry_point) {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                let target = 'brk: {
                    let main_target = self.transpiler.options.target;
                    if main_target.is_server_side() {
                        if let Some(path) = resolved.path_const() {
                            if let Some(loader) = path.loader(&self.transpiler.options.loaders) {
                                if loader == Loader::Html {
                                    self.ensure_client_transpiler();
                                    break 'brk Target::Browser;
                                }
                            }
                        }
                    }
                    break 'brk main_target;
                };
                let _ = self.enqueue_entry_item(&mut resolved, true, target)?;
            }
            Ok(())
        }

        #[cold]
        pub fn enqueue_entry_points_dev_server(
            &mut self,
            files: bake_types::EntryPointList,
            css_data: &mut ArrayHashMap<Index, CssEntryPointMeta>,
        ) -> Result<(), Error> {
            self.enqueue_entry_points_common()?;
            debug_assert!(self.dev_server.is_some());

            let num_entry_points = files.set.count();
            self.graph.entry_points.reserve(num_entry_points);
            self.graph
                .input_files
                .ensure_unused_capacity(num_entry_points)?;

            debug_assert_eq!(files.set.keys().len(), files.set.values().len());
            for (abs_path, flags) in files.set.keys().iter().zip(files.set.values().iter()) {
                // Ensure we have the proper conditions set for client-side entrypoints.
                // SAFETY: Zig stores `transpiler` as a raw `*Transpiler` across the loop body;
                // mirror with `*mut` so it doesn't keep `self` borrowed through the plugin
                // dispatch / dev_server calls below.
                let transpiler: *mut Transpiler<'a> =
                    if flags.client() && !flags.server() && !flags.ssr() {
                        std::ptr::from_mut(self.transpiler_for_target(Target::Browser))
                    } else {
                        &raw mut *self.transpiler
                    };
                let server_target = self.transpiler.options.target;

                struct TargetCheck {
                    should_dispatch: bool,
                    target: options::Target,
                }
                let targets_to_check = [
                    TargetCheck {
                        should_dispatch: flags.client(),
                        target: Target::Browser,
                    },
                    TargetCheck {
                        should_dispatch: flags.server(),
                        target: server_target,
                    },
                    TargetCheck {
                        should_dispatch: flags.ssr(),
                        target: Target::BakeServerComponentsSsr,
                    },
                ];

                let mut any_plugin_matched = false;
                for target_info in &targets_to_check {
                    if target_info.should_dispatch {
                        if self.enqueue_entry_point_on_resolve_plugin_if_needed(
                            abs_path,
                            target_info.target,
                        ) {
                            any_plugin_matched = true;
                        }
                    }
                }

                if any_plugin_matched {
                    continue;
                }

                // Fall back to normal resolution if no plugins matched
                // SAFETY: `transpiler` points at one of self's transpilers, live for `'a`.
                let mut resolved = match unsafe { &mut *transpiler }.resolve_entry_point(abs_path) {
                    Ok(r) => r,
                    Err(err) => {
                        let dev = self.dev_server.expect("unreachable");
                        dev.handle_parse_task_failure(
                            err,
                            if flags.client() {
                                bake::Graph::Client
                            } else {
                                bake::Graph::Server
                            },
                            abs_path,
                            unsafe { (*transpiler).log }.cast_const(),
                            std::ptr::from_mut(self),
                        )
                        .expect("oom");
                        unsafe { (*(*transpiler).log).reset() };
                        continue;
                    }
                };

                if flags.client() {
                    'brk: {
                        let Some(source_index) =
                            self.enqueue_entry_item(&mut resolved, true, Target::Browser)?
                        else {
                            break 'brk;
                        };
                        if flags.css() {
                            css_data.put_no_clobber(
                                Index::init(source_index),
                                CssEntryPointMeta {
                                    imported_on_server: false,
                                },
                            )?;
                        }
                    }
                }
                if flags.server() {
                    let _ = self.enqueue_entry_item(
                        &mut resolved,
                        true,
                        self.transpiler.options.target,
                    )?;
                }
                if flags.ssr() {
                    let _ = self.enqueue_entry_item(
                        &mut resolved,
                        true,
                        Target::BakeServerComponentsSsr,
                    )?;
                }
            }
            Ok(())
        }

        #[cold]
        pub fn enqueue_entry_points_bake_production(
            &mut self,
            data: &bake_types::production::EntryPointMap,
        ) -> Result<(), Error> {
            self.enqueue_entry_points_common()?;
            self.reserve_source_indexes_for_bake()?;

            let num_entry_points = data.files.count();
            self.graph.entry_points.reserve(num_entry_points);
            self.graph
                .input_files
                .ensure_unused_capacity(num_entry_points)?;

            for key in data.files.keys() {
                let abs_path = key.abs_path();
                let target = match key.side {
                    bake::Side::Client => Target::Browser,
                    bake::Side::Server => self.transpiler.options.target,
                };

                if self.enqueue_entry_point_on_resolve_plugin_if_needed(abs_path, target) {
                    continue;
                }

                // no plugins matched
                let mut resolved = match self.transpiler.resolve_entry_point(abs_path) {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                // TODO: wrap client files so the exports arent preserved.
                let Some(_) = self.enqueue_entry_item(&mut resolved, true, target)? else {
                    continue;
                };
            }
            Ok(())
        }

        /// Common prelude shared by all enqueue_entry_points_* variants: add the runtime task.
        fn enqueue_entry_points_common(&mut self) -> Result<(), Error> {
            // Add the runtime
            let rt = ParseTask::get_runtime_source(self.transpiler.options.target);
            self.graph.input_files.append(crate::Graph::InputFile {
                source: rt.source,
                loader: Loader::Js,
                side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
                ..Default::default()
            })?;

            // try this.graph.entry_points.append(arena, Index.runtime);
            let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget
            self.path_to_source_index_map(self.transpiler.options.target)
                .put(&b"bun:wrap"[..], Index::RUNTIME.get())
                .expect("oom");
            // SAFETY: arena (`self.graph.heap`) outlives the bundle pass; coerce the
            // `&mut ParseTask` to `*mut` immediately so the `&self` borrow from
            // `arena()` ends before we take `&mut self` below.
            let runtime_parse_task: *mut ParseTask = self.arena().alloc(rt.parse_task);
            unsafe {
                // BACKREF — lifetime erased per ParseTask::ctx convention.
                (*runtime_parse_task).ctx = Some(bun_ptr::ParentRef::from_raw_mut(
                    std::ptr::from_mut(self).cast::<BundleV2<'static>>(),
                ));
                (*runtime_parse_task).tree_shaking = true;
                (*runtime_parse_task).loader = Some(Loader::Js);
            }
            self.increment_scan_counter();
            self.graph.pool().schedule(runtime_parse_task);
            Ok(())
        }

        #[cold]
        fn clone_ast(&mut self) -> Result<(), Error> {
            let _trace = crate::ungate_support::perf::trace("Bundler.cloneAST");
            // TODO(port): bun.safety.alloc.assertEq
            self.linker.graph.ast = self.graph.ast.clone()?;

            for module_scope in self.linker.graph.ast.items_module_scope_mut() {
                // `children` are arena-allocated `StoreRef<Scope>`s; we re-point
                // their `parent` BACKREF at the cloned module scope. `StoreRef`'s
                // safe `DerefMut` replaces the open-coded `unsafe { child.as_mut() }`.
                let parent_ptr = bun_ast::StoreRef::from(NonNull::from(&mut *module_scope));
                for child in module_scope.children.slice_mut() {
                    child.parent = Some(parent_ptr);
                }

                if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
                    /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */
                }

                module_scope.generated = module_scope.generated.clone();
            }

            // Some parts of the AST are owned by worker allocators at this point.
            // Transfer ownership to the graph heap.
            self.linker.graph.take_ast_ownership();
            Ok(())
        }

        /// This generates the two asts for 'bun:bake/client' and 'bun:bake/server'. Both are generated
        /// at the same time in one pass over the SCB list.
        #[cold]
        pub fn process_server_component_manifest_files(&mut self) -> Result<(), AllocError> {
            // If a server components is not configured, do nothing
            let Some(fw) = &self.framework else {
                return Ok(());
            };
            let Some(sc) = &fw.server_components else {
                return Ok(());
            };

            if !self.graph.kit_referenced_server_data && !self.graph.kit_referenced_client_data {
                return Ok(());
            }

            // SAFETY: arena (`self.graph.heap`) outlives the bundle pass; erase the
            // `&self` borrow so `server`/`client` don't keep `*self` borrowed across
            // the `self.graph.ast.set(...)` calls at the end of this function.
            let alloc: &'static bun_alloc::Arena =
                unsafe { bun_ptr::detach_lifetime_ref::<bun_alloc::Arena>(self.arena()) };

            let hmr = self.transpiler.options.hot_module_reloading;
            let mut server = AstBuilder::init(alloc, &bake::SERVER_VIRTUAL_SOURCE, hmr)?;
            let mut client = AstBuilder::init(alloc, &bake::CLIENT_VIRTUAL_SOURCE, hmr)?;

            let mut server_manifest_props: Vec<G::Property> = Vec::new();
            let mut client_manifest_props: Vec<G::Property> = Vec::new();

            let scbs = self.graph.server_component_boundaries.list.slice();
            let named_exports_array = self.graph.ast.items_named_exports();

            let id_string = server.new_expr(E::EString {
                data: b"id".into(),
                ..Default::default()
            });
            let name_string = server.new_expr(E::EString {
                data: b"name".into(),
                ..Default::default()
            });
            let chunks_string = server.new_expr(E::EString {
                data: b"chunks".into(),
                ..Default::default()
            });
            let specifier_string = server.new_expr(E::EString {
                data: b"specifier".into(),
                ..Default::default()
            });
            let empty_array = server.new_expr(E::Array::default());

            for ((r#use, source_id), ssr_index) in scbs
                .items_use_directive()
                .iter()
                .zip(scbs.items_source_index().iter())
                .zip(scbs.items_ssr_source_index().iter())
            {
                if *r#use == bun_ast::UseDirective::Client {
                    // TODO(@paperclover/bake): this file is being generated far too
                    // early. we don't know which exports are dead and which exports
                    // are live. Tree-shaking figures that out. However,
                    // tree-shaking happens after import binding, which would
                    // require this ast.
                    //
                    // The plan: change this to generate a stub ast which only has
                    // `export const serverManifest = undefined;`, and then
                    // re-generate this file later with the properly decided
                    // manifest. However, I will probably reconsider how this
                    // manifest is being generated when I write the whole
                    // "production build" part of Bake.

                    let keys = named_exports_array[*source_id as usize].keys();
                    // PORT NOTE: `G::Property: !Clone` — build via iterator instead of `vec![v; n]`.
                    let mut client_manifest_items: Box<[G::Property]> =
                        (0..keys.len()).map(|_| G::Property::default()).collect();

                    if !sc.separate_ssr_graph {
                        bun_core::todo_panic!("separate_ssr_graph=false");
                    }

                    // SAFETY: arena slice — `alloc` (== `self.graph.heap`) outlives
                    // the produced AST. See `interned_slice` contract.
                    let astr = |s: &[u8]| -> &'static [u8] { unsafe { interned_slice(s) } };

                    let client_path = server.new_expr(E::EString {
                        data: astr(
                            alloc.alloc_slice_copy(
                                format!(
                                    "{}",
                                    chunk::UniqueKey {
                                        prefix: self.unique_key,
                                        kind: chunk::QueryKind::Scb,
                                        index: *source_id
                                    }
                                )
                                .as_bytes(),
                            ),
                        )
                        .into(),
                        ..Default::default()
                    });
                    let ssr_path = server.new_expr(E::EString {
                        data: astr(
                            alloc.alloc_slice_copy(
                                format!(
                                    "{}",
                                    chunk::UniqueKey {
                                        prefix: self.unique_key,
                                        kind: chunk::QueryKind::Scb,
                                        index: *ssr_index
                                    }
                                )
                                .as_bytes(),
                            ),
                        )
                        .into(),
                        ..Default::default()
                    });

                    debug_assert_eq!(keys.len(), client_manifest_items.len());
                    for (export_name_string, client_item) in
                        keys.iter().zip(client_manifest_items.iter_mut())
                    {
                        let server_key_string = astr(
                            alloc.alloc_slice_copy(
                                format!(
                                    "{}#{}",
                                    chunk::UniqueKey {
                                        prefix: self.unique_key,
                                        kind: chunk::QueryKind::Scb,
                                        index: *source_id
                                    },
                                    bstr::BStr::new(export_name_string),
                                )
                                .as_bytes(),
                            ),
                        );
                        let export_name = server.new_expr(E::EString {
                            data: astr(export_name_string).into(),
                            ..Default::default()
                        });

                        // write dependencies on the underlying module, not the proxy
                        server_manifest_props.push(G::Property {
                            key: Some(server.new_expr(E::EString {
                                data: server_key_string.into(),
                                ..Default::default()
                            })),
                            value: Some(server.new_expr(E::Object {
                                properties: bun_ast::g::PropertyList::from_owned_slice(Box::new([
                                    G::Property {
                                        key: Some(id_string),
                                        value: Some(client_path),
                                        ..Default::default()
                                    },
                                    G::Property {
                                        key: Some(name_string),
                                        value: Some(export_name),
                                        ..Default::default()
                                    },
                                    G::Property {
                                        key: Some(chunks_string),
                                        value: Some(empty_array),
                                        ..Default::default()
                                    },
                                ])),
                                ..Default::default()
                            })),
                            ..Default::default()
                        });
                        *client_item = G::Property {
                            key: Some(export_name),
                            value: Some(server.new_expr(E::Object {
                                properties: bun_ast::g::PropertyList::from_owned_slice(Box::new([
                                    G::Property {
                                        key: Some(name_string),
                                        value: Some(export_name),
                                        ..Default::default()
                                    },
                                    G::Property {
                                        key: Some(specifier_string),
                                        value: Some(ssr_path),
                                        ..Default::default()
                                    },
                                ])),
                                ..Default::default()
                            })),
                            ..Default::default()
                        };
                    }

                    client_manifest_props.push(G::Property {
                        key: Some(client_path),
                        value: Some(server.new_expr(E::Object {
                            properties: bun_ast::g::PropertyList::from_owned_slice(
                                client_manifest_items,
                            ),
                            ..Default::default()
                        })),
                        ..Default::default()
                    });
                } else {
                    bun_core::todo_panic!("\"use server\"");
                }
            }

            let server_manifest_ref =
                server.new_symbol(bun_ast::symbol::Kind::Other, b"serverManifest")?;
            let server_manifest_value = server.new_expr(E::Object {
                properties: bun_ast::g::PropertyList::move_from_list(server_manifest_props),
                ..Default::default()
            });
            server.append_stmt(S::Local {
                kind: bun_ast::s::Kind::KConst,
                decls: bun_ast::g::DeclList::from_owned_slice(Box::new([G::Decl {
                    binding: Binding::alloc(
                        alloc,
                        bun_ast::b::Identifier {
                            r#ref: server_manifest_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    value: Some(server_manifest_value),
                }])),
                is_export: true,
                ..Default::default()
            })?;
            let ssr_manifest_ref =
                server.new_symbol(bun_ast::symbol::Kind::Other, b"ssrManifest")?;
            let ssr_manifest_value = server.new_expr(E::Object {
                properties: bun_ast::g::PropertyList::move_from_list(client_manifest_props),
                ..Default::default()
            });
            server.append_stmt(S::Local {
                kind: bun_ast::s::Kind::KConst,
                decls: bun_ast::g::DeclList::from_owned_slice(Box::new([G::Decl {
                    binding: Binding::alloc(
                        alloc,
                        bun_ast::b::Identifier {
                            r#ref: ssr_manifest_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    value: Some(ssr_manifest_value),
                }])),
                is_export: true,
                ..Default::default()
            })?;

            let server_ast: JSAst = server.to_bundled_ast(Target::Bun)?;
            let client_ast: JSAst = client.to_bundled_ast(Target::Browser)?;
            self.graph
                .ast
                .set(Index::BAKE_SERVER_DATA.get() as usize, server_ast);
            self.graph
                .ast
                .set(Index::BAKE_CLIENT_DATA.get() as usize, client_ast);
            Ok(())
        }

        #[cold]
        pub fn enqueue_parse_task(
            &mut self,
            resolve_result: &_resolver::Result,
            source: &mut bun_ast::Source,
            loader: Loader,
            known_target: options::Target,
        ) -> Result<IndexInt, AllocError> {
            let source_index = Index::init(u32::try_from(self.graph.ast.len()).expect("int cast"));
            let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

            self.graph.input_files.append(crate::Graph::InputFile {
                source: core::mem::take(source),
                loader,
                side_effects: loader.side_effects(),
                ..Default::default()
            })?;
            // PORT NOTE: `ParseTask::init` takes `bun_ast::Index`; both Index newtypes
            // are `repr(transparent)` u32 so reconstruct via `.get()`.
            // Arena-owned (Zig: `arena.create(ParseTask)`); freed on heap reset.
            let task_val = ParseTask::init(
                resolve_result,
                bun_ast::Index::init(source_index.get()),
                self,
            );
            // SAFETY: arena outlives the bundle pass; reborrow `*mut` as `&mut`.
            let task: &mut ParseTask = self.arena_create(task_val);
            task.loader = Some(loader);
            task.jsx = self.transpiler_for_target(known_target).options.jsx.clone();
            task.task.node.next = core::ptr::null_mut();
            task.io_task.node.next = core::ptr::null_mut();
            task.tree_shaking = self.linker.options.tree_shaking;
            task.known_target = known_target;

            self.increment_scan_counter();

            // Handle onLoad plugins
            if !self.enqueue_on_load_plugin_if_needed(task) {
                if loader.should_copy_for_bundling() {
                    let additional_files: &mut Vec<crate::AdditionalFile> =
                        &mut self.graph.input_files.items_additional_files_mut()
                            [source_index.get() as usize];
                    additional_files
                        .push(crate::AdditionalFile::SourceIndex(task.source_index.get()));
                    self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] =
                        bun_ast::SideEffects::NoSideEffectsPureData;
                    self.graph.estimated_file_loader_count += 1;
                }

                self.graph.pool().schedule(task);
            }

            Ok(source_index.get())
        }

        #[cold]
        pub fn enqueue_parse_task2(
            &mut self,
            source: &mut bun_ast::Source,
            loader: Loader,
            known_target: options::Target,
        ) -> Result<IndexInt, AllocError> {
            let source_index = Index::init(u32::try_from(self.graph.ast.len()).expect("int cast"));
            let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

            self.graph.input_files.append(crate::Graph::InputFile {
                source: core::mem::take(source),
                loader,
                side_effects: loader.side_effects(),
                ..Default::default()
            })?;
            // `core::mem::take` moved the real `Source` into `graph.input_files`,
            // leaving `*source` as `Default`. Read path/contents back from the
            // graph's stored copy (where the data now lives for the rest of the
            // bundle pass) so the `ParseTask` below sees the actual source bytes —
            // matches Zig, which copies `source.*` by value and then reads the
            // still-intact original.
            let stored = &self.graph.input_files.items_source()[source_index.get() as usize];
            // PORT NOTE: Zig had a single `fs.Path`; Rust split it into
            // `bun_paths::fs::Path<'static>` (on `Source`) and `bun_resolver::fs::Path`
            // (on `ParseTask`). Convert field-by-field — `pretty`/`namespace` MUST
            // be preserved here (the SCB `separate_ssr_graph=false` caller passes a
            // source whose path went through `path_with_pretty_initialized`, and
            // `ParseTask::run` builds the `Source` from `task.path` then swaps it
            // back into `input_files`, so dropping `pretty` would surface the
            // absolute path as the dev-server module key).
            let task_path: Fs::Path<'static> = stored.path.clone();
            // SAFETY: `graph.input_files` owns `stored.contents` for the bundle
            // pass (arena lifetime); erase the borrow to `'static` to fit
            // `ContentsOrFd::Contents`. See `interned_slice` contract.
            let contents: &'static [u8] = unsafe { interned_slice(stored.contents()) };
            // Compute borrow-heavy fields up front so the `&self` borrow taken by
            // `arena()` doesn't overlap `&mut self` uses inside the literal.
            let jsx = if known_target == Target::BakeServerComponentsSsr
                && !self
                    .framework
                    .as_ref()
                    .unwrap()
                    .server_components
                    .as_ref()
                    .unwrap()
                    .separate_ssr_graph
            {
                self.transpiler.options.jsx.clone()
            } else {
                self.transpiler_for_target(known_target).options.jsx.clone()
            };
            let tree_shaking = self.linker.options.tree_shaking;
            // SAFETY: arena (`self.graph.heap`) outlives the bundle pass; coerce the
            // `&mut ParseTask` to `*mut` immediately so the `&self` borrow from
            // `arena()` ends before we take `&mut self` below.
            let task: *mut ParseTask = self.arena().alloc(ParseTask {
                path: task_path,
                contents_or_fd: parse_task::ContentsOrFd::Contents(contents),
                side_effects: bun_ast::SideEffects::HasSideEffects,
                jsx,
                source_index: bun_ast::Index::init(source_index.get()),
                module_type: options::ModuleType::Unknown,
                emit_decorator_metadata: false, // TODO
                package_version: bun_ast::StoreStr::EMPTY,
                loader: Some(loader),
                tree_shaking,
                known_target,
                ..Default::default()
            });
            unsafe {
                // BACKREF — lifetime erased per ParseTask::ctx convention.
                (*task).ctx = Some(bun_ptr::ParentRef::from_raw_mut(
                    std::ptr::from_mut(self).cast::<BundleV2<'static>>(),
                ));
                (*task).task.node.next = core::ptr::null_mut();
                (*task).io_task.node.next = core::ptr::null_mut();
            }

            self.increment_scan_counter();

            // Handle onLoad plugins
            if !self.enqueue_on_load_plugin_if_needed(unsafe { &mut *task }) {
                if loader.should_copy_for_bundling() {
                    let additional_files: &mut Vec<crate::AdditionalFile> =
                        &mut self.graph.input_files.items_additional_files_mut()
                            [source_index.get() as usize];
                    additional_files.push(crate::AdditionalFile::SourceIndex(source_index.get()));
                    self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] =
                        bun_ast::SideEffects::NoSideEffectsPureData;
                    self.graph.estimated_file_loader_count += 1;
                }

                self.graph.pool().schedule(task);
            }
            Ok(source_index.get())
        }

        /// Enqueue a ServerComponentParseTask.
        /// `source_without_index` is copied and assigned a new source index. That index is returned.
        #[cold]
        pub fn enqueue_server_component_generated_file(
            &mut self,
            data: crate::ServerComponentParseTask::Data,
            source_without_index: bun_ast::Source,
        ) -> Result<IndexInt, AllocError> {
            let mut new_source = source_without_index;
            let source_index = self.graph.input_files.len();
            new_source.index = bun_ast::Index(source_index as u32);
            // PORT NOTE: `bun_ast::Source: !Clone` — manually dup the (all-Clone) fields.
            let task_source = bun_ast::Source {
                path: new_source.path.clone(),
                contents: new_source.contents.clone(),
                contents_is_recycled: new_source.contents_is_recycled,
                identifier_name: new_source.identifier_name.clone(),
                index: new_source.index,
            };
            self.graph.input_files.append(crate::Graph::InputFile {
                source: new_source,
                loader: Loader::Js,
                side_effects: bun_ast::SideEffects::HasSideEffects,
                ..Default::default()
            })?;
            let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

            // PORT NOTE: `bun.new(ServerComponentParseTask, …)` — heap-owned by the
            // worker pool; freed via `bun.destroy` in `on_complete` after the
            // result posts back to the bundle thread.
            let task = bun_core::heap::into_raw(Box::new(ServerComponentParseTask {
                data,
                // Lifetime-erase `'a` → `'static` for the BACKREF (matches Zig `*BundleV2`).
                // `NonNull::from(&mut *self)` carries write provenance for `assume_mut`
                // in `on_complete`; `ParentRef::from(NonNull)` is the safe wrapper.
                ctx: Some(bun_ptr::ParentRef::from(
                    core::ptr::NonNull::from(&mut *self).cast::<BundleV2<'static>>(),
                )),
                source: task_source,
                // `..Default::default()` supplies `task: ThreadPoolTask { callback: task_callback_wrap }`.
                ..Default::default()
            }));

            self.increment_scan_counter();

            // SAFETY: `task` is the just-allocated arena box; sole reference here.
            self.graph
                .pool()
                .worker_pool()
                .schedule(bun_threading::thread_pool::Batch::from(unsafe {
                    core::ptr::addr_of_mut!((*task).task)
                }));

            Ok(u32::try_from(source_index).expect("int cast"))
        }
    }

    pub struct DependenciesScanner {
        pub ctx: *mut (),
        pub entry_points: Box<[Box<[u8]>]>,
        pub on_fetch: fn(ctx: *mut (), result: &mut DependenciesScannerResult) -> Result<(), Error>,
    }

    pub struct DependenciesScannerResult<'r, 'a> {
        pub dependencies: bun_collections::StringSet,
        pub reachable_files: &'r [Index],
        pub bundle_v2: &'r mut BundleV2<'a>,
    }

    /// Callback contract for [`DependenciesScanner`]. Each call site's local
    /// `Analyzer` struct implements this; [`DependenciesScanner::new`] erases the
    /// concrete type behind a monomorphized trampoline — Rust's analogue of Zig's
    /// one-liner `.onFetch = @ptrCast(&Analyzer.onAnalyze)` (bundle_v2.zig:1492).
    pub trait OnDependenciesAnalyze {
        fn on_analyze(
            &mut self,
            result: &mut DependenciesScannerResult<'_, '_>,
        ) -> Result<(), Error>;
    }

    impl DependenciesScanner {
        /// Type-erase `analyzer` into the `(ctx, on_fetch)` pair. The returned
        /// scanner borrows `*analyzer` for its lifetime: caller must keep
        /// `analyzer` alive and exclusively owned until the scan completes
        /// (mirrors Zig's stack-local `Analyzer` + `*anyopaque` ctx pattern).
        pub fn new<A: OnDependenciesAnalyze>(
            analyzer: &mut A,
            entry_points: Box<[Box<[u8]>]>,
        ) -> Self {
            fn trampoline<A: OnDependenciesAnalyze>(
                ctx: *mut (),
                result: &mut DependenciesScannerResult,
            ) -> Result<(), Error> {
                // SAFETY: `ctx` was set from `&mut *analyzer` in `new`; the caller
                // contract guarantees `*analyzer` outlives the scanner and is not
                // otherwise borrowed, so reconstituting `&mut A` here is exclusive.
                let analyzer = unsafe { &mut *ctx.cast::<A>() };
                analyzer.on_analyze(result)
            }
            Self {
                ctx: core::ptr::from_mut(analyzer).cast::<()>(),
                entry_points,
                on_fetch: trampoline::<A>,
            }
        }
    }

    impl<'a> BundleV2<'a> {
        #[cold]
        pub fn get_all_dependencies(
            &mut self,
            reachable_files: &[Index],
            fetcher: &DependenciesScanner,
        ) -> Result<(), Error> {
            // Find all external dependencies from reachable files
            let mut external_deps = bun_collections::StringSet::new();

            let import_records = self.graph.ast.items_import_records();

            for source_index in reachable_files {
                let records: &[ImportRecord] = import_records[source_index.get() as usize].slice();
                for record in records {
                    if !record.source_index.is_valid()
                        && record.tag == bun_ast::ImportRecordTag::None
                    {
                        let path = &record.path.text;
                        // External dependency
                        if !path.is_empty()
                        // Check for either node or bun builtins
                        // We don't use the list from .bun because that includes third-party packages in some cases.
                        && !bun_resolve_builtins::HardcodedModule::Alias::has(path, Target::Node, Default::default())
                        && !path.starts_with(b"bun:")
                        && path != b"bun"
                        {
                            if strings::is_npm_package_name_ignore_length(path) {
                                external_deps.insert(path)?;
                            }
                        }
                    }
                }
            }
            let mut result = DependenciesScannerResult {
                dependencies: external_deps,
                bundle_v2: self,
                reachable_files,
            };
            (fetcher.on_fetch)(fetcher.ctx, &mut result)
        }

        #[cold]
        pub fn generate_from_cli(
            transpiler: &'a mut Transpiler<'a>,
            alloc: &bun_alloc::Arena,
            event_loop: EventLoop,
            enable_reloading: bool,
            reachable_files_count: &mut usize,
            minify_duration: &mut u64,
            source_code_size: &mut u64,
            fetcher: Option<&DependenciesScanner>,
        ) -> Result<BuildResult, Error> {
            let mut this = BundleV2::init(
                transpiler,
                None,
                alloc,
                event_loop,
                enable_reloading,
                None,
                ThreadLocalArena::new(),
            )?;
            this.unique_key = generate_unique_key();

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            // SAFETY: `transpiler.options.entry_points` is borrowed only for the duration
            // of `enqueue_entry_points_normal`, which never frees/reallocates it; raw-ptr
            // sidestep for the `&mut self` overlap (Zig stored both as raw `*Transpiler`).
            let entry_points: *const [Box<[u8]>] = &raw const *this.transpiler.options.entry_points;
            this.enqueue_entry_points_normal(unsafe { &*entry_points })?;

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            this.wait_for_parse();
            this.dump_pool_stats("parse");

            *minify_duration = (((bun_core::time::nano_timestamp() as i64)
                - (bun_core::start_time() as i64))
                / (bun_core::time::NS_PER_MS as i64)) as u64;
            *source_code_size = this.source_code_length as u64;

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            this.scan_for_secondary_paths();

            this.process_server_component_manifest_files()?;

            let mut reachable_files = this.find_reachable_files()?;
            *reachable_files_count = reachable_files.len().saturating_sub(1); // - 1 for the runtime

            this.process_files_to_copy(&reachable_files)?;

            this.add_server_component_boundaries_as_extra_entry_points()?;

            this.clone_ast()?;

            // SAFETY: `LinkerContext::link` takes `bundle` as a raw `*mut BundleV2` and only
            // touches fields disjoint from `this.linker` (`graph`, `transpiler`,
            // `dynamic_import_entry_points`, scalar reads) via `addr_of_mut!`/place
            // projection, so the `&mut this.linker` receiver and `*bundle_ptr` never produce
            // overlapping `&mut`. (Zig stored all as raw ptrs — bundle_v2.zig:1939.)
            let mut chunks = unsafe {
                let bundle_ptr: *mut BundleV2 = &raw mut *this;
                // `Graph::entry_points: Vec<Index>` and `link()` takes `&[Index]` —
                // both are `crate::Index` (= `bun_ast::Index`), so no cast is needed.
                let ep = (*bundle_ptr).graph.entry_points.as_slice();
                // Spec passes `this.graph.server_component_boundaries` by value-copy
                // (Zig struct copy), leaving the original intact for
                // `StaticRouteVisitor` (generateChunksInParallel) to read via
                // `parse_graph`. Borrow — do NOT `take`, which would empty the
                // graph slot and drop the moved-out `MultiArrayList` heap inside
                // `load()` (ASAN use-after-poison / wrong `fully_static`).
                let scbs = &(*bundle_ptr).graph.server_component_boundaries;
                // Project `.linker` via `bundle_ptr` (not `this.linker`) so no
                // second `Box::deref_mut` retag invalidates `ep`/`scbs` (SB).
                (*bundle_ptr)
                    .linker
                    .link(bundle_ptr, ep, scbs, &mut reachable_files)?
            };
            this.dump_pool_stats("link");

            // Do this at the very end, after processing all the imports/exports so that we can follow exports as needed.
            if let Some(fetch) = fetcher {
                this.get_all_dependencies(&reachable_files, fetch)?;
                return Ok(BuildResult {
                    output_files: Vec::new(),
                    metafile: None,
                    metafile_markdown: None,
                });
            }

            let output_files = crate::linker_context_mod::generate_chunks_in_parallel::<false>(
                &mut this.linker,
                &mut chunks,
            )?;
            this.dump_pool_stats("print");

            // Generate metafile if requested (CLI writes files in build_command.zig)
            let metafile: Option<Box<[u8]>> = if this.linker.options.metafile {
                match crate::linker_context::metafile_builder::generate(
                    &mut this.linker,
                    &mut chunks,
                ) {
                    Ok(m) => Some(m),
                    Err(err) => {
                        Output::warn(format_args!("Failed to generate metafile: {}", err));
                        None
                    }
                }
            } else {
                None
            };

            // Under `--watch` the watcher thread holds `*mut BundleV2` (via the
            // reloader's `ctx`) and dereferences it in `on_file_update` after this
            // function returns. In Zig the `BundleV2` is arena-allocated and the
            // arena is never freed (the caller diverges into `exitOrWatch`); in
            // Rust it's `Box`-allocated, so leak it here to match the spec lifetime.
            // Bounded leak: the next file change `execve()`s the process anyway.
            if enable_reloading {
                core::mem::forget(this);
            }

            // Markdown is generated later in build_command.zig for CLI
            Ok(BuildResult {
                output_files,
                metafile,
                metafile_markdown: None,
            })
        }

        /// Build only the parse graph for the given entry points and return the
        /// BundleV2 instance. No linking or code generation is performed; this is
        /// used by `bun test --changed` to walk import records and compute which
        /// test entry points transitively depend on a given set of source files.
        ///
        /// The returned BundleV2, its ThreadLocalArena, and its worker pool are
        /// intentionally left alive for the remainder of the process. Tearing
        /// the pool down via `deinitWithoutFreeingArena()` blocks on worker
        /// shutdown and contends with the runtime VM's own parse threads; the
        /// sole caller exec()s (watch mode) or exits shortly after, so the leak
        /// is bounded. Dupe anything you need out of the graph before returning
        /// to the caller.
        #[cold]
        pub fn scan_module_graph_from_cli(
            transpiler: &'a mut Transpiler<'a>,
            alloc: &bun_alloc::Arena,
            event_loop: EventLoop,
            entry_points: &[&[u8]],
        ) -> Result<Box<BundleV2<'a>>, Error> {
            let mut this = BundleV2::init(
                transpiler,
                None,
                alloc,
                event_loop,
                false,
                None,
                ThreadLocalArena::new(),
            )?;
            this.unique_key = generate_unique_key();

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            // enqueueEntryPoints schedules the runtime task before any fallible
            // allocation. If a later allocation fails we must still drain the
            // pool so workers aren't left holding pointers into the caller's
            // stack-allocated Transpiler.
            if let Err(err) = this.enqueue_entry_points_normal(entry_points) {
                this.wait_for_parse();
                return Err(err);
            }

            // Even if entry point resolution produced errors we still wait for
            // all enqueued parse tasks to finish so the graph is consistent.
            this.wait_for_parse();

            Ok(this)
        }

        #[cold]
        pub fn generate_from_bake_production_cli(
            entry_points: &bake_types::production::EntryPointMap,
            server_transpiler: &'a mut Transpiler<'a>,
            bake_options: BakeOptions<'a>,
            alloc: &bun_alloc::Arena,
            event_loop: EventLoop,
        ) -> Result<Vec<options::OutputFile>, Error> {
            let mut this = BundleV2::init(
                server_transpiler,
                Some(bake_options),
                alloc,
                event_loop,
                false,
                None,
                ThreadLocalArena::new(),
            )?;
            this.unique_key = generate_unique_key();

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            this.enqueue_entry_points_bake_production(entry_points)?;

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            this.wait_for_parse();

            if this.transpiler.log().has_errors() {
                return Err(bun_core::err!("BuildFailed"));
            }

            this.scan_for_secondary_paths();

            this.process_server_component_manifest_files()?;

            let mut reachable_files = this.find_reachable_files()?;

            this.process_files_to_copy(&reachable_files)?;

            this.add_server_component_boundaries_as_extra_entry_points()?;

            this.clone_ast()?;

            // SAFETY: see `generate_from_cli` — raw-ptr borrow sidestep for
            // `link` takes a raw `*mut BundleV2` and only touches fields disjoint
            // from `this.linker`.
            let mut chunks = unsafe {
                let bundle_ptr: *mut BundleV2 = &raw mut *this;
                let ep = (*bundle_ptr).graph.entry_points.as_slice();
                // Spec: value-copy (original preserved for `StaticRouteVisitor`).
                // Borrow — do NOT `take` (see `generate_from_cli`).
                let scbs = &(*bundle_ptr).graph.server_component_boundaries;
                // Project `.linker` via `bundle_ptr` so no second `Box::deref_mut`
                // retag invalidates `ep`/`scbs` (SB hygiene).
                (*bundle_ptr)
                    .linker
                    .link(bundle_ptr, ep, scbs, &mut reachable_files)?
            };

            if chunks.is_empty() {
                return Ok(Vec::new());
            }

            let mut chunks = chunks;
            crate::linker_context_mod::generate_chunks_in_parallel::<false>(
                &mut this.linker,
                &mut chunks,
            )
        }

        #[cold]
        pub fn add_server_component_boundaries_as_extra_entry_points(
            &mut self,
        ) -> Result<(), Error> {
            // Prepare server component boundaries. Each boundary turns into two
            // entry points, a client entrypoint and a server entrypoint.
            //
            // TODO: This should be able to group components by the user specified
            // entry points. This way, using two component files in a route does not
            // create two separate chunks. (note: bake passes each route as an entrypoint)
            {
                let scbs = self.graph.server_component_boundaries.slice();
                self.graph.entry_points.reserve(scbs.list.len() * 2);
                debug_assert_eq!(
                    scbs.list.items_source_index().len(),
                    scbs.list.items_ssr_source_index().len()
                );
                for (original_index, ssr_index) in scbs
                    .list
                    .items_source_index()
                    .iter()
                    .zip(scbs.list.items_ssr_source_index().iter())
                {
                    for idx in [*original_index, *ssr_index] {
                        self.graph.entry_points.push(bun_ast::Index::init(idx)); // PERF(port): was assume_capacity
                    }
                }
            }
            Ok(())
        }

        #[cold]
        pub fn process_files_to_copy(&mut self, reachable_files: &[Index]) -> Result<(), Error> {
            if self.graph.estimated_file_loader_count > 0 {
                // PORT NOTE: Zig per-file `arena` column dropped — Box owns its alloc.
                // SAFETY: MultiArrayList columns are disjoint backing storage; raw-ptr
                // sidestep so we can hold several read-only column slices, one mutable
                // column slice (`additional_files`), and call `transpiler_for_target`
                // (which needs `&mut self`) inside the loop. Zig accessed all of these
                // as raw `.items(.field)` slices with no borrow-checking.
                let self_ptr: *mut Self = self;
                // SAFETY: see PORT NOTE above — disjoint MultiArrayList columns,
                // raw-ptr sidestep for split-borrow against `transpiler_for_target`
                // inside the loop. All six column derefs share the same invariant.
                let (
                    unique_key_for_additional_files,
                    content_hashes_for_additional_files,
                    sources,
                    targets,
                    additional_files,
                    loaders,
                ) = unsafe {
                    (
                        (*self_ptr)
                            .graph
                            .input_files
                            .items_unique_key_for_additional_file(),
                        (*self_ptr)
                            .graph
                            .input_files
                            .items_content_hash_for_additional_file(),
                        (*self_ptr).graph.input_files.items_source_mut(),
                        (*self_ptr).graph.ast.items_target(),
                        (*self_ptr).graph.input_files.items_additional_files_mut(),
                        (*self_ptr).graph.input_files.items_loader(),
                    )
                };
                let mut additional_output_files: Vec<options::OutputFile> = Vec::new();

                for reachable_source in reachable_files {
                    let index = reachable_source.get() as usize;
                    let key: &[u8] = &unique_key_for_additional_files[index];
                    if !key.is_empty() {
                        let mut template: options::PathTemplate =
                            if self.graph.html_imports.server_source_indices.len() != 0
                                && self.transpiler.options.asset_naming.is_empty()
                            {
                                options::PathTemplate::ASSET_WITH_TARGET.into()
                            } else {
                                options::PathTemplate::ASSET.into()
                            };

                        let target = targets[index];
                        // SAFETY: see `self_ptr` note above — `transpiler_for_target` needs
                        // `&mut self` only to pick between two stored `*mut Transpiler`s; it
                        // never touches `graph.input_files`.
                        let asset_naming = unsafe {
                            &(*self_ptr)
                                .transpiler_for_target(target)
                                .options
                                .asset_naming
                        };
                        if !asset_naming.is_empty() {
                            template.data = asset_naming.clone();
                        }

                        let source = &mut sources[index];

                        let output_path: Box<[u8]> = {
                            // TODO: outbase
                            let pathname =
                                Fs::PathName::init(bun_paths::resolve_path::relative_platform::<
                                    bun_paths::resolve_path::platform::Loose,
                                    false,
                                >(
                                    &self.transpiler.options.root_dir,
                                    &source.path.text,
                                ));

                            template.placeholder.name = pathname.base.to_vec().into_boxed_slice();
                            template.placeholder.dir = pathname.dir.to_vec().into_boxed_slice();
                            let mut ext: &[u8] = pathname.ext;
                            if !ext.is_empty() && ext[0] == b'.' {
                                ext = &ext[1..];
                            }
                            template.placeholder.ext = ext.to_vec().into_boxed_slice();

                            if template.needs(options::PlaceholderField::Hash) {
                                template.placeholder.hash =
                                    Some(content_hashes_for_additional_files[index]);
                            }

                            if template.needs(options::PlaceholderField::Target) {
                                template.placeholder.target = <&'static str>::from(target)
                                    .as_bytes()
                                    .to_vec()
                                    .into_boxed_slice();
                            }
                            let mut v = Vec::new();
                            template.print(&mut v).expect("oom");
                            v.into_boxed_slice()
                        };

                        let loader = loaders[index];

                        // Zig hands the existing `source.contents` buffer to the
                        // OutputFile (with its allocator) — no copy. Mirror that by
                        // moving the contents out instead of `to_vec()`-cloning,
                        // which is prohibitively expensive for large assets.
                        let contents_len = source.contents.len();
                        let contents = match core::mem::take(&mut source.contents) {
                            std::borrow::Cow::Owned(v) => v.into_boxed_slice(),
                            std::borrow::Cow::Borrowed(b) => Box::<[u8]>::from(b),
                        };

                        additional_output_files.push(options::OutputFile::init(
                            crate::output_file::Options {
                                source_index: crate::output_file::Index::init(index as u32)
                                    .to_optional(),
                                data: crate::output_file::OptionsData::Buffer { data: contents },
                                size: Some(contents_len),
                                output_path,
                                input_path: source.path.text.to_vec().into_boxed_slice(),
                                input_loader: Loader::File,
                                output_kind: crate::options::OutputKind::Asset,
                                loader,
                                hash: Some(content_hashes_for_additional_files[index]),
                                side: Some(crate::options::Side::Client),
                                entry_point_index: None,
                                is_executable: false,
                                ..Default::default()
                            },
                        ));
                        additional_files[index].push(crate::AdditionalFile::OutputFile(
                            (additional_output_files.len() - 1) as u32,
                        ));
                    }
                }

                self.graph.additional_output_files = additional_output_files;
            }
            Ok(())
        }

        #[cold]
        pub fn on_load_async(&mut self, load: &mut jsc_api::JSBundler::Load) {
            // Dispatch to the loop that *owns* `BundleV2` (Zig: `switch (this.loop().*)`).
            // For `Bun.build` this is a Mini loop running on the bundler thread, so
            // `on_load` must land there — not on the JS plugin loop — or it will
            // mutate `graph` / allocate from `graph.heap` off-thread.
            match self.any_loop_mut() {
                bun_event_loop::AnyEventLoop::Js { owner } => {
                    owner.enqueue_task_concurrent(
                        bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(
                            std::ptr::from_mut(load),
                            on_load_from_js_loop_raw,
                        ),
                    );
                }
                bun_event_loop::AnyEventLoop::Mini(mini) => {
                    mini.enqueue_task_concurrent_with_extra_ctx::<jsc_api::JSBundler::Load, BundleV2<'static>>(
                    std::ptr::from_mut(load),
                    on_load_mini,
                    core::mem::offset_of!(jsc_api::JSBundler::Load, task),
                );
                }
            }
        }

        #[cold]
        pub fn on_resolve_async(&mut self, resolve: &mut jsc_api::JSBundler::Resolve) {
            // See `on_load_async` — must dispatch on the bundler's own loop.
            match self.any_loop_mut() {
                bun_event_loop::AnyEventLoop::Js { owner } => {
                    owner.enqueue_task_concurrent(
                        bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(
                            std::ptr::from_mut(resolve),
                            on_resolve_from_js_loop_raw,
                        ),
                    );
                }
                bun_event_loop::AnyEventLoop::Mini(mini) => {
                    mini.enqueue_task_concurrent_with_extra_ctx::<jsc_api::JSBundler::Resolve, BundleV2<'static>>(
                    std::ptr::from_mut(resolve),
                    on_resolve_mini,
                    core::mem::offset_of!(jsc_api::JSBundler::Resolve, task),
                );
                }
            }
        }
    }

    #[cold]
    fn on_load_mini(load: *mut jsc_api::JSBundler::Load, this: *mut BundleV2<'static>) {
        // SAFETY: callback contract — `load` is the ctx passed to
        // `enqueue_task_concurrent_with_extra_ctx`; `this` is the BundleV2 the
        // mini loop's `tick` supplies as ParentContext.
        BundleV2::on_load(unsafe { &mut *load }, unsafe { &mut *this });
    }

    #[cold]
    fn on_resolve_mini(resolve: *mut jsc_api::JSBundler::Resolve, this: *mut BundleV2<'static>) {
        // SAFETY: see `on_load_mini`.
        BundleV2::on_resolve(unsafe { &mut *resolve }, unsafe { &mut *this });
    }

    #[cold]
    pub fn on_load_from_js_loop(load: &mut jsc_api::JSBundler::Load) {
        // SAFETY: `bv2` is a live backref set in `Load::init`.
        let bv2 = unsafe { &mut *load.bv2 };
        BundleV2::on_load(load, bv2);
    }

    #[cold]
    fn on_load_from_js_loop_raw(
        load: *mut jsc_api::JSBundler::Load,
    ) -> bun_event_loop::JsResult<()> {
        // SAFETY: `load` is a valid pointer set up by `from_callback`.
        on_load_from_js_loop(unsafe { &mut *load });
        Ok(())
    }

    impl<'a> BundleV2<'a> {
        #[cold]
        pub fn on_load(load: &mut jsc_api::JSBundler::Load, this: &mut BundleV2) {
            bun_core::scoped_log!(
                Bundle,
                "onLoad: ({}, {:?})",
                load.source_index.get(),
                core::mem::discriminant(&load.value)
            );
            // PORT NOTE: `helpCatchMemoryIssues` was a mimalloc TLH probe; bumpalo has no equivalent.
            let _ = FeatureFlags::HELP_CATCH_MEMORY_ISSUES;
            // `log_mut()` returns an unbounded `&mut Log` (backref to the
            // arena/DevServer-owned log) so the `&mut this.graph.*` reborrows
            // below type-check without per-use-site `unsafe { &mut *log }`.
            let log = this.transpiler.log_mut();

            // TODO: watcher

            match load.value.consume() {
                jsc_api::JSBundler::LoadValue::NoMatch => {
                    let source =
                        &this.graph.input_files.items_source()[load.source_index.get() as usize];
                    // If it's a file namespace, we should run it through the parser like normal.
                    // The file could be on disk.
                    if source.path.is_file() {
                        this.graph.pool().schedule(load.parse_task_mut());
                        return;
                    }

                    // When it's not a file, this is a build error and we should report it.
                    // we have no way of loading non-files.
                    let _ = log.add_error_fmt(
                        Some(source),
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Module not found {} in namespace {}",
                            bun_core::fmt::quote(&source.path.pretty),
                            bun_core::fmt::quote(&source.path.namespace),
                        ),
                    );

                    // An error occurred, prevent spinning the event loop forever
                    this.decrement_scan_counter();
                }
                jsc_api::JSBundler::LoadValue::Success(code) => {
                    let code = code; // LoadSuccess { source_code, loader }
                    // When a plugin returns a file loader, we always need to populate additional_files
                    let should_copy_for_bundling = code.loader.should_copy_for_bundling();
                    if should_copy_for_bundling {
                        let source_index = load.source_index;
                        let additional_files: &mut Vec<crate::AdditionalFile> =
                            &mut this.graph.input_files.items_additional_files_mut()
                                [source_index.get() as usize];
                        let _ = additional_files
                            .push(crate::AdditionalFile::SourceIndex(source_index.get()));
                        this.graph.input_files.items_side_effects_mut()
                            [source_index.get() as usize] =
                            bun_ast::SideEffects::NoSideEffectsPureData;
                        this.graph.estimated_file_loader_count += 1;
                    }
                    this.graph.input_files.items_loader_mut()[load.source_index.get() as usize] =
                        code.loader;
                    // Ownership of `code.source_code` diverges on
                    // `should_copy_for_bundling` (spec bundle_v2.zig:1970):
                    // copy-for-bundling buffers are owned by the input-file slot
                    // (Zig: `InputFile.arena` column → `ExternalFreeFunctionAllocator`)
                    // so they outlive `free_list` teardown for
                    // `dev.put_or_overwrite_asset`. The Rust port dropped that
                    // column, so own them in `source.contents` as `Cow::Owned`
                    // (same lifetime as the Zig per-slot arena). Non-copy
                    // buffers go to `free_list`.
                    let source_code: &'static [u8] = if should_copy_for_bundling {
                        let contents = &mut this.graph.input_files.items_source_mut()
                            [load.source_index.get() as usize]
                            .contents;
                        *contents = std::borrow::Cow::Owned(code.source_code.into());
                        // SAFETY: `Cow::Owned` heap data is address-stable across
                        // SoA column moves; `input_files` outlives all ParseTasks.
                        unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(contents.as_ref()) }
                    } else {
                        this.free_list.push(code.source_code);
                        // SAFETY: `free_list` is append-only until
                        // `deinit_without_freeing_arena` (after all ParseTasks
                        // complete); the boxed slice is heap-stable.
                        let last = this.free_list.last().unwrap();
                        let s: &'static [u8] =
                            unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(last) };
                        this.graph.input_files.items_source_mut()
                            [load.source_index.get() as usize]
                            .contents = std::borrow::Cow::Borrowed(s);
                        s
                    };
                    this.graph.input_files.items_flags_mut()[load.source_index.get() as usize]
                        .insert(crate::Graph::InputFileFlags::IS_PLUGIN_FILE);
                    let parse_task = load.parse_task_mut();
                    parse_task.loader = Some(code.loader);
                    parse_task.contents_or_fd = parse_task::ContentsOrFd::Contents(source_code);
                    this.graph.pool().schedule(parse_task);

                    if this.bun_watcher.is_some() {
                        'add_watchers: {
                            if !this.should_add_watcher_plugin(&load.namespace, &load.path) {
                                break 'add_watchers;
                            }

                            // TODO: support explicit watchFiles array. this is not done
                            // right now because DevServer requires a table to map
                            // watched files and dirs to their respective dependants.
                            let fd = if bun_watcher::REQUIRES_FILE_DESCRIPTORS {
                                let mut buf = bun_paths::path_buffer_pool::get();
                                // PORT NOTE: Zig used `std.posix.toPosixPath` (copy + NUL-
                                // terminate); on kqueue platforms paths are already
                                // posix-separated so `z()` alone suffices.
                                match bun_sys::open(
                                    bun_paths::resolve_path::z(load.path.as_ref(), &mut *buf),
                                    bun_watcher::WATCH_OPEN_FLAGS,
                                    0,
                                ) {
                                    bun_sys::Result::Ok(fd) => fd,
                                    bun_sys::Result::Err(_) => break 'add_watchers,
                                }
                            } else {
                                bun_sys::Fd::INVALID
                            };

                            // Zig: `_ = this.bun_watcher.?.addFile(...) catch {};`
                            let _ = this.bun_watcher_mut().unwrap().add_file::<true>(
                                fd,
                                &load.path,
                                bun_wyhash::hash(load.path.as_ref()) as u32,
                                bun_watcher::Loader(code.loader as u8),
                                bun_sys::Fd::INVALID,
                                None,
                            );
                        }
                    }
                }
                jsc_api::JSBundler::LoadValue::Err(msg) => {
                    if let Some(dev) = this.dev_server {
                        let source = &this.graph.input_files.items_source()
                            [load.source_index.get() as usize];
                        // A stack-allocated Log object containing the singular message
                        let kind = msg.kind;
                        let temp_log = bun_ast::Log {
                            clone_line_text: false,
                            errors: (kind == bun_ast::Kind::Err) as u32,
                            warnings: (kind == bun_ast::Kind::Warn) as u32,
                            msgs: vec![msg],
                            ..Default::default()
                        };
                        dev.handle_parse_task_failure(
                            bun_core::err!("Plugin"),
                            load.bake_graph(),
                            source.path.key_for_incremental_graph(),
                            &raw const temp_log,
                            this,
                        )
                        .expect("oom");
                    } else {
                        let kind = msg.kind;
                        log.msgs.push(msg);
                        log.errors += (kind == bun_ast::Kind::Err) as u32;
                        log.warnings += (kind == bun_ast::Kind::Warn) as u32;
                    }

                    // An error occurred, prevent spinning the event loop forever
                    this.decrement_scan_counter();
                }
                jsc_api::JSBundler::LoadValue::Pending
                | jsc_api::JSBundler::LoadValue::Consumed => unreachable!(),
            }
            // load is dropped here (defer load.deinit())
        }
    }

    #[cold]
    pub fn on_resolve_from_js_loop(resolve: &mut jsc_api::JSBundler::Resolve) {
        // SAFETY: `bv2` is a live backref set in `Resolve::init`.
        let bv2 = unsafe { &mut *resolve.bv2 };
        BundleV2::on_resolve(resolve, bv2);
    }

    #[cold]
    fn on_resolve_from_js_loop_raw(
        resolve: *mut jsc_api::JSBundler::Resolve,
    ) -> bun_event_loop::JsResult<()> {
        // SAFETY: `resolve` is a valid pointer set up by `from_callback`.
        on_resolve_from_js_loop(unsafe { &mut *resolve });
        Ok(())
    }

    impl<'a> BundleV2<'a> {
        #[cold]
        pub fn on_resolve(resolve: &mut jsc_api::JSBundler::Resolve, this: &mut BundleV2) {
            // Zig: `defer this.decrementScanCounter()`. RAII guard captures `this`
            // as a raw pointer so it does not hold a unique borrow across the body.
            let _dec_guard = this.decrement_scan_counter_on_drop();
            bun_core::scoped_log!(
                Bundle,
                "onResolve: ({}:{}, {:?})",
                bstr::BStr::new(&resolve.import_record.namespace),
                bstr::BStr::new(&resolve.import_record.specifier),
                core::mem::discriminant(&resolve.value)
            );

            // PORT NOTE: `helpCatchMemoryIssues` was a mimalloc TLH probe; bumpalo has no equivalent.
            let _ = FeatureFlags::HELP_CATCH_MEMORY_ISSUES;

            match resolve.value.consume() {
                jsc_api::JSBundler::ResolveValue::NoMatch => {
                    // If it's a file namespace, we should run it through the resolver like normal.
                    //
                    // The file could be on disk.
                    if resolve.import_record.namespace.as_ref() == b"file" {
                        if resolve.import_record.kind == ImportKind::EntryPointBuild {
                            let target = resolve.import_record.original_target;
                            let Ok(resolved) = this
                                .transpiler_for_target(target)
                                .resolve_entry_point(&resolve.import_record.specifier)
                            else {
                                return;
                            };
                            let mut resolved = resolved;
                            let Ok(source_index) =
                                this.enqueue_entry_item(&mut resolved, true, target)
                            else {
                                return;
                            };

                            // Store the original entry point name for virtual entries that fall back to file resolution
                            if let Some(idx) = source_index {
                                let _ = this
                                    .graph
                                    .entry_point_original_names
                                    .put(idx, &resolve.import_record.specifier);
                            }
                            return;
                        }

                        this.run_resolver(
                            resolve.import_record.clone(),
                            resolve.import_record.original_target,
                        );
                        return;
                    }

                    // SAFETY: Zig's `logForResolutionFailures` returns `*Log` (raw ptr).
                    // Holding the `&mut bun_ast::Log` borrow would alias `&this.graph`
                    // below; detach the lifetime so borrowck releases `this`. The log
                    // lives in `this.transpiler`/`this.framework`, disjoint from
                    // `graph.input_files`.
                    let log: &mut bun_ast::Log = unsafe {
                        bun_ptr::detach_lifetime_mut(this.log_for_resolution_failures(
                            &resolve.import_record.source_file,
                            resolve.import_record.original_target.bake_graph(),
                        ))
                    };

                    // When it's not a file, this is an error and we should report it.
                    //
                    // We have no way of loading non-files.
                    if resolve.import_record.kind == ImportKind::EntryPointBuild {
                        let _ = log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Module not found {} in namespace {}",
                                bun_core::fmt::quote(&resolve.import_record.specifier),
                                bun_core::fmt::quote(&resolve.import_record.namespace),
                            ),
                        );
                    } else {
                        let source = &this.graph.input_files.items_source()
                            [resolve.import_record.importer_source_index as usize];
                        let _ = log.add_range_error_fmt(
                            Some(source),
                            resolve.import_record.range,
                            format_args!(
                                "Module not found {} in namespace {}",
                                bun_core::fmt::quote(&resolve.import_record.specifier),
                                bun_core::fmt::quote(&resolve.import_record.namespace),
                            ),
                        );
                    }
                }
                jsc_api::JSBundler::ResolveValue::Success(result) => {
                    let mut out_source_index: Option<Index> = None;
                    if !result.external {
                        // SAFETY: `result.{path,namespace}` are `Box<[u8]>` whose heap
                        // allocations are moved into `this.free_list` below (in the
                        // `!found_existing` branch) and thus outlive `BundleV2`. Erase
                        // to `'static` so `Fs::Path<'static>` can borrow them across
                        // `path_with_pretty_initialized` / `ParseTask` (mirrors Zig's
                        // untracked-slice ownership). In the `found_existing`/`external`
                        // branches `path` is dead before the boxes drop, so the dangling
                        // `'static` is never observed.
                        let (result_path_static, result_ns_static): (&'static [u8], &'static [u8]) = unsafe {
                            (
                                &*std::ptr::from_ref::<[u8]>(result.path.as_ref()),
                                &*std::ptr::from_ref::<[u8]>(result.namespace.as_ref()),
                            )
                        };
                        let mut path = Fs::Path::init(result_path_static);
                        if result.namespace.is_empty() || result.namespace.as_ref() == b"file" {
                            path.namespace = b"file";
                        } else {
                            path.namespace = result_ns_static;
                        }

                        // SAFETY: `GetOrPutResult` borrows `&mut this` for its whole
                        // lifetime, blocking the `free_list`/`graph` accesses below.
                        // Capture `value_ptr` as a raw ptr + `found_existing` and drop
                        // the borrow; the map entry is not rehashed before we write
                        // through `value_ptr` (no intervening map mutation).
                        let (value_ptr, found_existing) = {
                            let existing = this
                                .path_to_source_index_map(resolve.import_record.original_target)
                                .get_or_put(path.text)
                                .expect("oom");
                            (
                                std::ptr::from_mut(existing.value_ptr),
                                existing.found_existing,
                            )
                        };
                        if !found_existing {
                            // Move (not clone) — `path` keeps borrowing the heap bytes via the
                            // `'static` erasure above; `Box<[u8]>` heap data does not relocate
                            // when the Box itself is moved into the Vec.
                            this.free_list.push(result.namespace);
                            this.free_list.push(result.path);
                            path = this
                                .path_with_pretty_initialized(
                                    path,
                                    resolve.import_record.original_target,
                                )
                                .expect("oom");
                            // PORT NOTE: `GetOrPutResult` has no `key_ptr` — `get_or_put` already
                            // duped the key into the map (see PathToSourceIndexMap.rs).

                            // We need to parse this
                            let source_index =
                                Index::init(u32::try_from(this.graph.ast.len()).expect("int cast"));
                            unsafe { *value_ptr = source_index.get() };
                            out_source_index = Some(source_index);
                            let _ = this.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                            let loader = path
                                .loader(&this.transpiler.options.loaders)
                                .unwrap_or(Loader::File);

                            this.graph
                                .input_files
                                .append(crate::Graph::InputFile {
                                    source: bun_ast::Source {
                                        // PORT NOTE: Zig assigned `path` (Fs.Path) directly;
                                        // shim to the field-identical `bun_paths::fs::Path<'static>`.
                                        path: path_as_static(path.clone()),
                                        contents: std::borrow::Cow::Borrowed(&b""[..]),
                                        index: bun_ast::Index(source_index.get()),
                                        ..Default::default()
                                    },
                                    loader,
                                    side_effects: bun_ast::SideEffects::HasSideEffects,
                                    ..Default::default()
                                })
                                .expect("unreachable");
                            let task_val = ParseTask {
                                // SAFETY: write provenance from `ptr::from_mut`; outlives the task.
                                ctx: Some(unsafe {
                                    bun_ptr::ParentRef::from_raw_mut(
                                        std::ptr::from_mut::<BundleV2>(this)
                                            .cast::<BundleV2<'static>>(),
                                    )
                                }),
                                path,
                                // unknown at this point:
                                contents_or_fd: parse_task::ContentsOrFd::Fd {
                                    dir: bun_sys::Fd::INVALID,
                                    file: bun_sys::Fd::INVALID,
                                },
                                side_effects: bun_ast::SideEffects::HasSideEffects,
                                jsx: this
                                    .transpiler_for_target(resolve.import_record.original_target)
                                    .options
                                    .jsx
                                    .clone(),
                                source_index: bun_ast::Index::init(source_index.get()),
                                module_type: options::ModuleType::Unknown,
                                loader: Some(loader),
                                tree_shaking: this.linker.options.tree_shaking,
                                known_target: resolve.import_record.original_target,
                                ..Default::default()
                            };
                            // Arena-owned (Zig: `arena.create(ParseTask)`).
                            // SAFETY: arena outlives the bundle pass.
                            let task: &mut ParseTask = this.arena_create(task_val);
                            task.task.node.next = core::ptr::null_mut();
                            task.io_task.node.next = core::ptr::null_mut();
                            this.increment_scan_counter();

                            if !this.enqueue_on_load_plugin_if_needed(task) {
                                if loader.should_copy_for_bundling() {
                                    let additional_files: &mut Vec<crate::AdditionalFile> =
                                        &mut this.graph.input_files.items_additional_files_mut()
                                            [source_index.get() as usize];
                                    additional_files.push(crate::AdditionalFile::SourceIndex(
                                        task.source_index.get(),
                                    ));
                                    this.graph.input_files.items_side_effects_mut()
                                        [source_index.get() as usize] =
                                        bun_ast::SideEffects::NoSideEffectsPureData;
                                    this.graph.estimated_file_loader_count += 1;
                                }

                                this.graph.pool().schedule(task);
                            }
                        } else {
                            out_source_index = Some(Index::init(unsafe { *value_ptr }));
                            // PORT NOTE: Zig freed result.{namespace,path} here; Rust drops below.
                            drop(result.namespace);
                            drop(result.path);
                        }
                    } else {
                        drop(result.namespace);
                        drop(result.path);
                    }

                    if let Some(source_index) = out_source_index {
                        if resolve.import_record.kind == ImportKind::EntryPointBuild {
                            this.graph
                                .entry_points
                                .push(bun_ast::Index::init(source_index.get()));

                            // Store the original entry point name for virtual entries
                            // This preserves the original name for output file naming
                            let _ = this
                                .graph
                                .entry_point_original_names
                                .put(source_index.get(), &resolve.import_record.specifier);
                        } else {
                            let source_import_records =
                                &mut this.graph.ast.items_import_records_mut()
                                    [resolve.import_record.importer_source_index as usize];
                            if source_import_records.len() as u32
                                <= resolve.import_record.import_record_index
                            {
                                let entry = this
                                    .resolve_tasks_waiting_for_import_source_index
                                    .get_or_put(resolve.import_record.importer_source_index)
                                    .expect("oom");
                                if !entry.found_existing {
                                    *entry.value_ptr = Vec::new();
                                }
                                let _ = entry.value_ptr.push(PendingImport {
                                    to_source_index: source_index,
                                    import_record_index: resolve.import_record.import_record_index,
                                });
                            } else {
                                let import_record: &mut ImportRecord = &mut source_import_records
                                    .slice_mut()
                                    [resolve.import_record.import_record_index as usize];
                                import_record.source_index = source_index;
                            }
                        }
                    }
                }
                jsc_api::JSBundler::ResolveValue::Err(err) => {
                    let log = this.log_for_resolution_failures(
                        &resolve.import_record.source_file,
                        resolve.import_record.original_target.bake_graph(),
                    );
                    let kind = err.kind;
                    log.msgs.push(err.clone());
                    log.errors += (kind == bun_ast::Kind::Err) as u32;
                    log.warnings += (kind == bun_ast::Kind::Warn) as u32;
                }
                jsc_api::JSBundler::ResolveValue::Pending
                | jsc_api::JSBundler::ResolveValue::Consumed => unreachable!(),
            }
            // resolve is dropped here (defer resolve.deinit())
        }

        #[cold]
        pub fn deinit_without_freeing_arena(&mut self) {
            {
                // We do this first to make it harder for any dangling pointers to data to be used in there.
                let on_parse_finalizers = core::mem::take(&mut self.finalizers);
                for finalizer in &on_parse_finalizers {
                    finalizer.call();
                }
                drop(on_parse_finalizers);
            }

            // Zig spec (bundle_v2.zig:2229): `defer { this.graph.{ast,input_files,
            // entry_points,entry_point_original_names}.deinit(this.allocator()) }`.
            // In Zig those `MultiArrayList`s only free their slab — the per-element
            // payloads (file contents, quoted source-map JSON, …) live in
            // `this.graph.heap` (a mimalloc thread-local heap), so the caller's
            // `defer heap.deinit()` bulk-frees them. The Rust port reads file
            // contents and JSON-quoted source contents into the *global* heap
            // (`Vec<u8>`/`Box<[u8]>` — see ParseTask.rs `read_file_with_allocator`
            // TODO and `compute_quoted_source_contents`), and `MultiArrayList::drop`
            // matches Zig in *not* running element destructors. Result: every
            // `Bun.build()` leaked the entry source plus its quoted source contents
            // (~2× input size — test/bundler/bun-build-api.test.ts "does not leak
            // sourcemap JSON" observed ~100MB/build for a 30MB input). Explicitly
            // take-and-drop the global-heap-owned columns here so the slab-only
            // drop that follows (when `bv2` goes out of scope) doesn't strand them.
            {
                use crate::linker_graph::FileColumns as _;
                for s in self.graph.input_files.items_source_mut() {
                    // `Source.contents: Cow<'static, [u8]>` — borrowed arms (arena
                    // slices, FileMap entries) are no-ops; only `Owned(Vec<u8>)`
                    // from `read_file_with_allocator` actually frees here.
                    s.contents = std::borrow::Cow::Borrowed(&b""[..]);
                }
                for q in self.linker.graph.files.items_quoted_source_contents_mut() {
                    drop(q.take());
                }
                for t in self.linker.graph.files.items_line_offset_table_mut() {
                    // `LineOffsetTable::List` is itself a `MultiArrayList`; its
                    // own elements are POD-ish, so `Drop` (slab free) suffices.
                    *t = Default::default();
                }

                // `MultiArrayList<BundledAst>` is the dominant retainer (LSan with
                // System allocator: ~67 MB/iter `Vec<Part>` via `add_part_to_file`,
                // ~9 MB/iter `Scope::members` via `prepare_for_visit_pass`). Zig
                // covers this with `Ast::deinit` (parts/symbols/import_records) +
                // `graph.heap.deinit()` for the rest; the Rust port's
                // `MultiArrayList::drop` is slab-only and these are global-heap
                // `Vec`/`HashMap`. `linker.graph.ast` is a bitwise SoA `memcpy` of
                // `graph.ast` (see `MultiArrayList::clone`, line 2840), then
                // mutated in-place (e.g. `add_part_to_file` reallocates `parts`),
                // so it is the post-mutation owner; the parse-side rows are
                // bitwise aliases (or stale post-realloc) and — being slab-only on
                // drop — never run element destructors, so freeing here once is
                // not a double-free. If `link()` errored before the clone ran the
                // linker side is empty and the parse side is the sole owner.
                macro_rules! take_ast_cols {
                    ($ast:expr) => {{
                        let ast = $ast;
                        for v in ast.items_parts_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_symbols_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_import_records_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_named_imports_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_named_exports_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_export_star_import_records_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_module_scope_mut() {
                            // Not in Zig `Ast::deinit` — Zig's `Scope::members` /
                            // `children` were arena-backed, the port's are
                            // global-heap `HashMap` / `Vec`.
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_top_level_symbols_to_parts_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_commonjs_named_exports_mut() {
                            drop(core::mem::take(v));
                        }
                        for v in ast.items_ts_enums_mut() {
                            drop(core::mem::take(v));
                        }
                    }};
                }
                if self.linker.graph.ast.len() != 0 {
                    take_ast_cols!(&mut self.linker.graph.ast);
                } else {
                    take_ast_cols!(&mut self.graph.ast);
                }
                // `LinkerGraph::meta` (also a slab-only `MultiArrayList`); LSan
                // ~12 MB/iter `Vec<ExportData>` via `LinkerContext::load`.
                macro_rules! take_col {
                    ($mal:expr, $m:ident) => {
                        for v in $mal.$m() {
                            drop(core::mem::take(v));
                        }
                    };
                }
                let meta = &mut self.linker.graph.meta;
                take_col!(meta, items_probably_typescript_type_mut);
                take_col!(meta, items_imports_to_bind_mut);
                take_col!(meta, items_resolved_exports_mut);
                take_col!(meta, items_sorted_and_filtered_export_aliases_mut);
                take_col!(meta, items_top_level_symbol_to_parts_overlay_mut);
                take_col!(meta, items_cjs_export_copies_mut);
            }

            // Drop the lazily-created client transpiler (if any) before tearing
            // down workers — matches the .zig spec ordering where the arena slot
            // is invalidated ahead of `pool.workers_assignments` so no worker can
            // observe a half-torn-down transpiler. Clear the `client_transpiler`
            // alias first so it never dangles past the Box drop; in the
            // `BakeOptions`-borrowed path `owned_client_transpiler` is `None` and
            // the DevServer-owned pointer is left untouched.
            if self.owned_client_transpiler.is_some() {
                self.client_transpiler = None;
                self.owned_client_transpiler = None;
            }

            // bundle_v2.zig:1426-1437 — worker-assignment teardown.
            let pool = self.graph.pool_mut();
            {
                let mut assignments = pool.workers_assignments.lock();
                if assignments.count() > 0 {
                    for worker in assignments.values() {
                        // SAFETY: worker ptrs are live until `deinit_soon`.
                        unsafe { (**worker).deinit_soon() };
                    }
                    assignments.clear_retaining_capacity();
                    pool.worker_pool().wake_for_idle_events();
                }
            }
            pool.deinit();

            for free in self.free_list.drain(..) {
                drop(free);
            }
        }

        #[cold]
        pub fn run_from_js_in_new_thread(
            &mut self,
            entry_points: &[&[u8]],
        ) -> Result<BuildResult, Error> {
            self.unique_key = generate_unique_key();

            if self.transpiler.log().errors > 0 {
                return Err(bun_core::err!("BuildFailed"));
            }

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            self.enqueue_entry_points_normal(entry_points)?;

            // We must wait for all the parse tasks to complete, even if there are errors.
            self.wait_for_parse();

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            if self.transpiler.log().errors > 0 {
                return Err(bun_core::err!("BuildFailed"));
            }

            self.scan_for_secondary_paths();

            self.process_server_component_manifest_files()?;

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            self.clone_ast()?;

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            let reachable_files = self.find_reachable_files()?;

            self.process_files_to_copy(&reachable_files)?;

            self.add_server_component_boundaries_as_extra_entry_points()?;

            // SAFETY: see `generate_from_cli` — repr(transparent) Index slice cast +
            // raw-ptr borrow sidestep for `&mut self.linker` / `&mut *self`.
            let mut chunks = unsafe {
                let bundle_ptr: *mut BundleV2 = self;
                let ep = (*bundle_ptr).graph.entry_points.as_slice();
                // Spec: value-copy (original preserved for `StaticRouteVisitor`).
                // Borrow — do NOT `take` (see `generate_from_cli`).
                let scbs = &(*bundle_ptr).graph.server_component_boundaries;
                let mut reachable_files = reachable_files;
                // Project `.linker` via `bundle_ptr` so no `&mut *self` reborrow
                // retag invalidates `ep`/`scbs` (SB hygiene).
                (*bundle_ptr)
                    .linker
                    .link(bundle_ptr, ep, scbs, &mut reachable_files)?
            };

            if self.transpiler.log().errors > 0 {
                return Err(bun_core::err!("BuildFailed"));
            }

            let mut output_files = crate::linker_context_mod::generate_chunks_in_parallel::<false>(
                &mut self.linker,
                &mut chunks,
            )?;

            // Generate metafile if requested
            let metafile: Option<Box<[u8]>> = if self.linker.options.metafile {
                match crate::linker_context::metafile_builder::generate(
                    &mut self.linker,
                    &mut chunks,
                ) {
                    Ok(m) => Some(m),
                    Err(err) => {
                        Output::warn(format_args!("Failed to generate metafile: {}", err.name()));
                        None
                    }
                }
            } else {
                None
            };

            // Generate markdown if metafile was generated and path specified
            let metafile_markdown: Option<Box<[u8]>> =
                if !self.linker.options.metafile_markdown_path.is_empty() && metafile.is_some() {
                    match crate::linker_context::metafile_builder::generate_markdown(
                        metafile.as_ref().unwrap(),
                    ) {
                        Ok(m) => Some(m),
                        Err(err) => {
                            Output::warn(format_args!(
                                "Failed to generate metafile markdown: {}",
                                err
                            ));
                            None
                        }
                    }
                } else {
                    None
                };

            // Write metafile outputs to disk and add them as OutputFiles.
            // Metafile paths are relative to outdir, like all other output files.
            // `LinkerContext::resolver()` wraps the `*mut Resolver` backref deref.
            let outdir = &self.linker.resolver().opts.output_dir;
            if !self.linker.options.metafile_json_path.is_empty() {
                if let Some(mf) = &metafile {
                    write_metafile_output(
                        &mut output_files,
                        outdir,
                        &self.linker.options.metafile_json_path,
                        mf,
                        crate::options::OutputKind::MetafileJson,
                    )?;
                }
            }
            if !self.linker.options.metafile_markdown_path.is_empty() {
                if let Some(md) = &metafile_markdown {
                    write_metafile_output(
                        &mut output_files,
                        outdir,
                        &self.linker.options.metafile_markdown_path,
                        md,
                        crate::options::OutputKind::MetafileMarkdown,
                    )?;
                }
            }

            Ok(BuildResult {
                output_files,
                metafile,
                metafile_markdown,
            })
        }
    }

    /// Writes a metafile (JSON or markdown) to disk and appends it to the output_files list.
    /// Metafile paths are relative to outdir, like all other output files.
    #[cold]
    fn write_metafile_output(
        output_files: &mut Vec<options::OutputFile>,
        outdir: &[u8],
        file_path: &[u8],
        content: &[u8],
        output_kind: crate::options::OutputKind,
    ) -> Result<(), Error> {
        if !outdir.is_empty() {
            // Open the output directory and write the metafile relative to it.
            // PORT NOTE: Zig used `bun.FD.cwd().makeOpenPath()` +
            // `NodeFS.writeFileWithPathBuffer`. Route through `bun_sys::File`.
            let mut buf = bun_paths::path_buffer_pool::get();
            let joined = bun_paths::resolve_path::join_string_buf::<
                bun_paths::resolve_path::platform::Auto,
            >(&mut buf.0[..], &[outdir, file_path]);
            // Create parent directories if needed (relative to outdir).
            let parent = bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Loose>(
                joined,
            );
            if !parent.is_empty() {
                let _ = bun_sys::mkdir_recursive(parent);
            }
            let mut zbuf = bun_paths::path_buffer_pool::get();
            let joined_z = bun_paths::resolve_path::z(joined, &mut zbuf);
            match bun_sys::File::write_file(bun_core::Fd::cwd(), joined_z, content) {
                Ok(()) => {}
                Err(err) => {
                    Output::warn(format_args!(
                        "Failed to write metafile to '{}': {}",
                        bstr::BStr::new(file_path),
                        err
                    ));
                }
            }
        }

        // Add as OutputFile so it appears in result.outputs
        let is_json = output_kind == crate::options::OutputKind::MetafileJson;
        output_files.push(options::OutputFile::init(crate::output_file::Options {
            loader: if is_json { Loader::Json } else { Loader::File },
            input_loader: if is_json { Loader::Json } else { Loader::File },
            input_path: Box::<[u8]>::from(if is_json {
                b"metafile.json".as_slice()
            } else {
                b"metafile.md".as_slice()
            }),
            output_path: Box::<[u8]>::from(file_path),
            data: crate::output_file::OptionsData::Saved(content.len()),
            output_kind,
            is_executable: false,
            side: None,
            entry_point_index: None,
            ..Default::default()
        }));
        Ok(())
    }

    impl<'a> BundleV2<'a> {
        fn should_add_watcher_plugin(&self, namespace: &[u8], path: &[u8]) -> bool {
            namespace == b"file" && bun_paths::is_absolute(path) && self.should_add_watcher(path)
        }

        fn should_add_watcher(&self, path: &[u8]) -> bool {
            if self.dev_server.is_some() {
                strings::index_of(path, b"/node_modules/").is_none()
                    && (if cfg!(windows) {
                        strings::index_of(path, b"\\node_modules\\").is_none()
                    } else {
                        true
                    })
            } else {
                true // `bun build --watch` has always watched node_modules
            }
        }

        /// Dev Server uses this instead to run a subset of the transpiler, and to run it asynchronously.
        #[cold]
        pub fn start_from_bake_dev_server(
            &mut self,
            bake_entry_points: bake_types::EntryPointList,
        ) -> Result<DevServerInput, Error> {
            self.unique_key = generate_unique_key();

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            let mut ctx = DevServerInput {
                css_entry_points: ArrayHashMap::new(),
            };
            self.enqueue_entry_points_dev_server(bake_entry_points, &mut ctx.css_entry_points)?;

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            Ok(ctx)
        }

        // TODO(b0-genuine): body has deep DevServer field access (current_bundle.start_data,
        // css_entry_points, etc.). After tier-6 collapse this fn should be HOISTED into
        // bun_runtime::bake (which can name DevServer concretely) and call back into BundleV2
        // helpers. Until then the entry-point fields are reached through the vtable.
        #[cold]
        pub fn finish_from_bake_dev_server(
            &mut self,
            dev_server: &dispatch::DevServerHandle,
        ) -> Result<(), AllocError> {
            // SAFETY: DevServer guarantees `current_bundle` is Some during finish (DevServer.zig:2237).
            // The vtable slot returns `*mut ()` derived from `&mut dev.current_bundle.?.start_data`;
            // DevServer holds it exclusively for the duration of finalize, so the `&mut DevServerInput`
            // here is mut-valid and unaliased until this fn returns.
            let start = unsafe {
                &mut *dev_server
                    .current_bundle_start_data()
                    .cast::<DevServerInput>()
            };

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            self.clone_ast().map_err(|_| AllocError)?;

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            self.dynamic_import_entry_points = ArrayHashMap::new();
            let mut html_files: ArrayHashMap<Index, ()> = ArrayHashMap::new();

            // Separate non-failing files into two lists: JS and CSS
            let js_reachable_files: &[Index] = 'reachable_files: {
                let mut css_total_files: Vec<Index> = Vec::with_capacity(self.graph.css_file_count);
                start.css_entry_points.reserve(self.graph.css_file_count);
                let mut js_files: Vec<Index> =
                    Vec::with_capacity(self.graph.ast.len() - self.graph.css_file_count - 1);

                let asts = self.graph.ast.slice();
                let css_asts = asts.items_css();
                // PORT NOTE: SoA columns are physically disjoint slabs but rustc cannot
                // see that through `&Slice`. Route the two columns we mutate (`parts`,
                // `import_records`) through `split_raw()` (root-provenance `*mut [T]`,
                // no `&mut` intermediate) so the per-index `&mut` does not conflict
                // with the `&asts` reads (`css`, `target`). Mirrors the pattern at
                // `find_reachable_files` (~L1457). The slab does not resize for the
                // duration of this loop and no other `&mut` to these columns exists.
                let ast_raw = asts.split_raw();
                let parts_col: *mut bun_ast::PartList = ast_raw.parts as *mut bun_ast::PartList;
                let import_records_col: *mut import_record::List =
                    ast_raw.import_records as *mut import_record::List;

                let input_files = self.graph.input_files.slice();
                let loaders = input_files.items_loader();
                let sources = input_files.items_source();
                // TODO(port): multi-zip iteration over MultiArrayList slices [1..]
                for index in 1..self.graph.ast.len() {
                    // SAFETY: `index < ast.len()`; see PORT NOTE above for column aliasing.
                    let part_list = unsafe { &mut *parts_col.add(index) };
                    let import_records = unsafe { &mut *import_records_col.add(index) };
                    let maybe_css = &css_asts[index];
                    let target = asts.items_target()[index];
                    // Dev Server proceeds even with failed files.
                    // These files are filtered out via the lack of any parts.
                    //
                    // Actual empty files will contain a part exporting an empty object.
                    if part_list.len() != 0 {
                        if maybe_css.is_some() {
                            // CSS has restrictions on what files can be imported.
                            // This means the file can become an error after
                            // resolution, which is not usually the case.
                            css_total_files
                                .push(Index::init(u32::try_from(index).expect("int cast"))); // PERF(port): was assume_capacity
                            let mut log = bun_ast::Log::init();
                            if LinkerContext::scan_css_imports(
                                u32::try_from(index).expect("int cast"),
                                import_records.slice(),
                                // PORT NOTE: `scan_css_imports` takes the column as a raw
                                // `*const` slice (the scanImportsAndExports caller holds raw
                                // SoA pointers); it only reads via `is_none()`. Zig spec
                                // (`LinkerContext.zig:496`) types this `[]const ?*...`.
                                std::ptr::from_ref(css_asts),
                                sources,
                                loaders,
                                &mut log,
                            ) == crate::linker_context_mod::ScanCssImportsResult::Errors
                            {
                                // TODO: it could be possible for a plugin to change
                                // the type of loader from whatever it was into a
                                // css-compatible loader.
                                dev_server
                                    .handle_parse_task_failure(
                                        bun_core::err!("InvalidCssImport"),
                                        bake::Graph::Client,
                                        &sources[index].path.text,
                                        &raw const log,
                                        self,
                                    )
                                    .map_err(|_| AllocError)?;
                                // Since there is an error, do not treat it as a
                                // valid CSS chunk.
                                let _ = start.css_entry_points.swap_remove(&Index::init(
                                    u32::try_from(index).expect("int cast"),
                                ));
                            }
                        } else {
                            // HTML files are special cased because they correspond
                            // to routes in DevServer. They have a JS chunk too,
                            // derived off of the import record list.
                            if loaders[index] == Loader::Html {
                                html_files.put(
                                    Index::init(u32::try_from(index).expect("int cast")),
                                    (),
                                )?;
                            } else {
                                js_files.push(Index::init(u32::try_from(index).expect("int cast"))); // PERF(port): was assume_capacity

                                // Mark every part live.
                                for p in part_list.slice_mut() {
                                    p.is_live = true;
                                }
                            }

                            // Discover all CSS roots.
                            for record in import_records.slice_mut() {
                                if !record.source_index.is_valid() {
                                    continue;
                                }
                                if loaders[record.source_index.get() as usize] != Loader::Css {
                                    continue;
                                }
                                // SAFETY: `source_index < ast.len()` (validated above); read
                                // via the raw column ptr so we don't reborrow `asts.parts()`
                                // while `import_records` (a sibling column) is held `&mut`.
                                if unsafe {
                                    (*parts_col.add(record.source_index.get() as usize)).len()
                                } == 0
                                {
                                    record.source_index = Index::INVALID;
                                    continue;
                                }

                                let gop = start
                                    .css_entry_points
                                    .get_or_put(record.source_index)
                                    .expect("oom");
                                if target != Target::Browser {
                                    *gop.value_ptr = CssEntryPointMeta {
                                        imported_on_server: true,
                                    };
                                } else if !gop.found_existing {
                                    *gop.value_ptr = CssEntryPointMeta {
                                        imported_on_server: false,
                                    };
                                }
                            }
                        }
                    } else {
                        // Treat empty CSS files for removal.
                        let _ = start
                            .css_entry_points
                            .swap_remove(&Index::init(u32::try_from(index).expect("int cast")));
                    }
                }

                // Find CSS entry points. Originally, this was computed up front, but
                // failed files do not remember their loader, and plugins can
                // asynchronously decide a file is CSS.
                let css = asts.items_css();
                for entry_point in &self.graph.entry_points {
                    if css[entry_point.get() as usize].is_some() {
                        start.css_entry_points.put(
                            Index::init(entry_point.get()),
                            CssEntryPointMeta {
                                imported_on_server: false,
                            },
                        )?;
                    }
                }

                // TODO(port): leak js_files into arena — Zig returned .items
                // SAFETY: `alloc_slice_copy` returns into the bundler arena which outlives
                // this function. Erase the `&self` lifetime via `*const` so the borrow on
                // `self.arena()` does not extend across the `&mut self` calls below
                // (Phase-A arena-erasure convention; see also `path.pretty` ~L4770).
                break 'reachable_files unsafe {
                    &*std::ptr::from_ref::<[Index]>(self.arena().alloc_slice_copy(&js_files))
                };
            };

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            // HMR skips most of the linker! All linking errors are converted into
            // runtime errors to avoid a more complicated dependency graph. For
            // example, if you remove an exported symbol, we only rebuild the
            // changed file, then detect the missing export at runtime.
            //
            // Additionally, notice that we run this code generation even if we have
            // files that failed. This allows having a large build graph (importing
            // a new npm dependency), where one file that fails doesnt prevent the
            // passing files to get cached in the incremental graph.

            // The linker still has to be initialized as code generation expects
            // much of its state to be valid memory, even if empty.
            // SAFETY: `LinkerContext::load` takes `bundle` as a raw `*mut BundleV2` and only
            // touches fields disjoint from `self.linker` (`graph`, `transpiler`,
            // `dynamic_import_entry_points`) via `addr_of_mut!`, so the `&mut self.linker`
            // receiver and `*bundle_ptr` never produce overlapping `&mut`. Both Index newtypes
            // are `#[repr(transparent)]` u32 — see `generate_from_cli` for the slice cast.
            unsafe {
                let bundle_ptr: *mut BundleV2 = self;
                let ep = (*bundle_ptr).graph.entry_points.as_slice();
                // Spec: value-copy (original preserved). Borrow — do NOT `take`.
                let scbs = &(*bundle_ptr).graph.server_component_boundaries;
                // Project `.linker` via `bundle_ptr` so no `&mut *self` reborrow
                // retag invalidates `ep`/`scbs` (SB hygiene).
                (*bundle_ptr)
                    .linker
                    .load(bundle_ptr, ep, scbs, js_reachable_files)
                    .map_err(|_| AllocError)?;
            }

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            // Compute line offset tables and quoted contents, used in source maps.
            // Quoted contents will be default-allocated
            if cfg!(debug_assertions) {
                for idx in js_reachable_files {
                    debug_assert!(self.graph.ast.items_parts()[idx.get() as usize].len() != 0); // will create a memory leak
                }
            }
            self.linker.compute_data_for_source_map(js_reachable_files);
            // TODO(port): errdefer { bun.outOfMemory() } — caller cannot recover

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            // Generate chunks
            let js_part_ranges = self
                .arena()
                .alloc_slice_fill_default::<crate::ungate_support::PartRange>(
                    js_reachable_files.len(),
                );
            let parts = self.graph.ast.items_parts();
            debug_assert_eq!(js_reachable_files.len(), js_part_ranges.len());
            for (source_index, part_range) in
                js_reachable_files.iter().zip(js_part_ranges.iter_mut())
            {
                *part_range = crate::ungate_support::PartRange {
                    source_index: *source_index,
                    part_index_begin: 0,
                    part_index_end: parts[source_index.get() as usize].len() as u32,
                };
            }

            // PORT NOTE: `Chunk: !Default` (Vec fields). Allocate via Vec then
            // leak into the arena.
            let mut chunks: Vec<Chunk> =
                Vec::with_capacity(1 + start.css_entry_points.count() + html_files.count());

            // First is a chunk to contain all JavaScript modules.
            chunks.push(Chunk {
                entry_point: chunk::EntryPoint::new(0, 0, true, false),
                content: chunk::Content::Javascript({
                    let mut js = chunk::JavaScriptChunk::default();
                    // TODO(@paperclover): remove this ptrCast when Source Index is fixed
                    js.files_in_chunk_order = js_reachable_files
                        .iter()
                        .map(|i| i.get())
                        .collect::<Vec<u32>>()
                        .into_boxed_slice();
                    js.parts_in_chunk_in_order = js_part_ranges.to_vec().into_boxed_slice();
                    js
                }),
                output_source_map: SourceMap::SourceMapPieces::init(),
                ..Chunk::default()
            });

            // Then all the distinct CSS bundles (these are JS->CSS, not CSS->CSS)
            for entry_point in start.css_entry_points.keys() {
                let order = crate::linker_context::find_imported_files_in_css_order::find_imported_files_in_css_order(&mut self.linker, &self.graph.heap, &[*entry_point]);
                let order_len = order.len() as usize;
                chunks.push(Chunk {
                    entry_point: chunk::EntryPoint::new(
                        entry_point.get(),
                        entry_point.get(),
                        false,
                        false,
                    ),
                    content: chunk::Content::Css(chunk::CssChunk {
                        imports_in_chunk_in_order: order,
                        asts: (0..order_len)
                            .map(|_| bun_css::BundlerStyleSheet::empty())
                            .collect::<Vec<_>>()
                            .into_boxed_slice(),
                    }),
                    output_source_map: SourceMap::SourceMapPieces::init(),
                    ..Chunk::default()
                });
            }

            // Then all HTML files
            for source_index in html_files.keys() {
                chunks.push(Chunk {
                    entry_point: chunk::EntryPoint::new(
                        source_index.get(),
                        source_index.get(),
                        false,
                        true,
                    ),
                    content: chunk::Content::Html,
                    output_source_map: SourceMap::SourceMapPieces::init(),
                    ..Chunk::default()
                });
            }
            // Arena-owned (Zig allocates `chunks` from `this.arena()`); the
            // `DevServerOutput` lifetime is documented as "tied to the bundler's
            // arena". `alloc_slice_fill_iter` moves each `Chunk` into the bump.
            let chunks: *mut [Chunk] = std::ptr::from_mut::<[Chunk]>(
                self.arena().alloc_slice_fill_iter(chunks.into_iter()),
            );
            // SAFETY: arena outlives this fn and the `DevServerOutput` it produces.
            let chunks: &mut [Chunk] = unsafe { &mut *chunks };

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            crate::linker_context_mod::generate_chunks_in_parallel::<true>(
                &mut self.linker,
                chunks,
            )
            .map_err(|_| AllocError)?;
            // TODO(port): errdefer { bun.outOfMemory() } — caller cannot recover

            /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

            dev_server
                .finalize_bundle(
                    self,
                    &mut DevServerOutput {
                        chunks,
                        css_file_list: core::mem::take(&mut start.css_entry_points),
                        html_files,
                    },
                )
                .map_err(|_| AllocError)
        }

        #[cold]
        pub fn enqueue_on_resolve_plugin_if_needed(
            &mut self,
            source_index: IndexInt,
            import_record: &ImportRecord,
            source_file: &[u8],
            import_record_index: u32,
            original_target: options::Target,
        ) -> bool {
            if let Some(plugins) = self.plugins_ref() {
                // PORT NOTE: `ImportRecord.path` is `bun_paths::fs::Path`; `has_any_matches`
                // takes the structurally-identical `bun_resolver::fs::Path`. Rebuild the
                // resolver-crate variant from the same backing slices (Zig has a single
                // `Fs.Path` type — the FFI side only reads `.text` / `.namespace`).
                let match_path = Fs::Path::init_with_namespace(
                    import_record.path.text,
                    import_record.path.namespace,
                );
                if plugins.has_any_matches(&match_path, false) {
                    // This is where onResolve plugins are enqueued
                    bun_core::scoped_log!(
                        Bundle,
                        "enqueue onResolve: {}:{}",
                        bstr::BStr::new(&import_record.path.namespace),
                        bstr::BStr::new(&import_record.path.text)
                    );
                    self.increment_scan_counter();

                    // Arena-owned (Zig: `arena.create(Resolve)`); the dispatch
                    // chain holds the raw `*mut Resolve` until the JS thread calls
                    // back, at which point the bundle pass is still alive.
                    // SAFETY: arena outlives the bundle pass.
                    let resolve: &mut jsc_api::JSBundler::Resolve =
                        self.arena_create(jsc_api::JSBundler::Resolve::default());
                    *resolve = jsc_api::JSBundler::Resolve::init(
                        self,
                        jsc_api::JSBundler::MiniImportRecord {
                            kind: import_record.kind,
                            source_file: source_file.into(),
                            namespace: import_record.path.namespace.into(),
                            specifier: import_record.path.text.to_vec().into_boxed_slice(),
                            importer_source_index: source_index,
                            import_record_index,
                            range: import_record.range,
                            original_target,
                        },
                    );

                    resolve.dispatch();
                    return true;
                }
            }

            false
        }

        #[cold]
        pub fn enqueue_entry_point_on_resolve_plugin_if_needed(
            &mut self,
            entry_point: &[u8],
            target: options::Target,
        ) -> bool {
            if let Some(plugins) = self.plugins_ref() {
                let mut temp_path = Fs::Path::init(entry_point.into());
                temp_path.namespace = b"file";
                if plugins.has_any_matches(&temp_path, false) {
                    bun_core::scoped_log!(
                        Bundle,
                        "Entry point '{}' plugin match",
                        bstr::BStr::new(entry_point)
                    );

                    // Arena-owned (Zig: `arena.create(Resolve)`).
                    // SAFETY: arena outlives the bundle pass.
                    let resolve: &mut jsc_api::JSBundler::Resolve =
                        self.arena_create(jsc_api::JSBundler::Resolve::default());
                    self.increment_scan_counter();

                    *resolve = jsc_api::JSBundler::Resolve::init(
                        self,
                        jsc_api::JSBundler::MiniImportRecord {
                            kind: ImportKind::EntryPointBuild,
                            source_file: Box::default(), // No importer for entry points
                            namespace: (&b"file"[..]).into(),
                            specifier: entry_point.into(),
                            importer_source_index: u32::MAX, // Sentinel value for entry points
                            import_record_index: 0,
                            range: bun_ast::Range::NONE,
                            original_target: target,
                        },
                    );

                    resolve.dispatch();
                    return true;
                }
            }
            false
        }

        #[cold]
        pub fn enqueue_on_load_plugin_if_needed(&mut self, parse: &mut ParseTask) -> bool {
            let had_matches = self.enqueue_on_load_plugin_if_needed_impl(parse);
            if had_matches {
                return true;
            }

            if parse.path.namespace == b"dataurl" {
                let Ok(maybe_data_url) = DataURL::parse(&parse.path.text) else {
                    return false;
                };
                let Some(data_url) = maybe_data_url else {
                    return false;
                };
                let Ok(maybe_decoded) = data_url.decode_data() else {
                    return false;
                };
                // Zig: `this.free_list.append(decoded); parse.contents_or_fd = .{ .contents = decoded };`
                // — the SAME allocation is both tracked for free at `deinit` and
                // borrowed as the parse-task contents. `free_list` owns it for the
                // bundle's lifetime; `ParseTask` is strictly shorter-lived, so the
                // raw-slice borrow is sound. No clone, no leak.
                self.free_list.push(maybe_decoded.into_boxed_slice());
                // SAFETY: `free_list` is append-only until `deinit_without_freeing_arena`
                // (after all ParseTasks have completed); the `Box<[u8]>` is heap-stable.
                let decoded: &'static [u8] =
                    unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(self.free_list.last().unwrap()) };
                parse.contents_or_fd = parse_task::ContentsOrFd::Contents(decoded);
                parse.loader = Some(match data_url.decode_mime_type().category {
                    bun_http_types::MimeType::Category::Javascript => Loader::Js,
                    bun_http_types::MimeType::Category::Css => Loader::Css,
                    bun_http_types::MimeType::Category::Json => Loader::Json,
                    _ => parse.loader.unwrap_or(Loader::File),
                });
            }

            false
        }

        #[cold]
        pub fn enqueue_on_load_plugin_if_needed_impl(&mut self, parse: &mut ParseTask) -> bool {
            if let Some(plugins) = self.plugins_ref() {
                if plugins.has_any_matches(&parse.path, true) {
                    // This is where onLoad plugins are enqueued
                    bun_core::scoped_log!(
                        Bundle,
                        "enqueue onLoad: {}:{}",
                        bstr::BStr::new(&parse.path.namespace),
                        bstr::BStr::new(&parse.path.text)
                    );
                    // Arena-owned (Zig: `arena.create(Load)`); the dispatch
                    // chain holds the raw `*mut Load` until the JS thread calls back.
                    let load_val = jsc_api::JSBundler::Load::init(self, parse);
                    // SAFETY: arena outlives the bundle pass.
                    let load: &mut jsc_api::JSBundler::Load = self.arena_create(load_val);
                    load.dispatch();
                    return true;
                }
            }

            false
        }

        fn path_with_pretty_initialized(
            &self,
            path: Fs::Path<'static>,
            target: options::Target,
        ) -> Result<Fs::Path<'static>, Error> {
            // SAFETY: arena outlives the bundle pass; erase the `&self` lifetime so the
            // returned `Path<'static>` doesn't keep `self` borrowed (borrowck).
            let bump: &'static bun_alloc::Arena =
                unsafe { bun_ptr::detach_lifetime_ref::<bun_alloc::Arena>(self.arena()) };
            // DEDUP(D059): route through the canonical body in `ungate_support`;
            // D090 unified `Fs::Path` and `bun_paths::fs::Path<'static>` so the shims are identity.
            let out = crate::ungate_support::generic_path_with_pretty_initialized(
                path_as_static(path),
                target,
                self.transpiler.fs().top_level_dir,
                bump,
            )?;
            Ok(out.clone())
        }

        #[cold]
        fn reserve_source_indexes_for_bake(&mut self) -> Result<(), Error> {
            let Some(fw) = &self.framework else {
                return Ok(());
            };
            if fw.server_components.is_none() {
                return Ok(());
            }

            // Call this after
            debug_assert!(self.graph.input_files.len() == 1);
            debug_assert!(self.graph.ast.len() == 1);

            self.graph.ast.ensure_unused_capacity(2)?;
            self.graph.input_files.ensure_unused_capacity(2)?;

            // PORT NOTE: Zig copied `bake.server_virtual_source` by value. The Rust
            // statics are `LazyLock<Source>` and `Source` is not `Clone`, so rebuild
            // an owned `Source` from the static's clonable fields (`path`, `index`).
            let server_source = bun_ast::Source {
                path: bake::SERVER_VIRTUAL_SOURCE.path.clone(),
                index: bake::SERVER_VIRTUAL_SOURCE.index,
                ..Default::default()
            };
            let client_source = bun_ast::Source {
                path: bake::CLIENT_VIRTUAL_SOURCE.path.clone(),
                index: bake::CLIENT_VIRTUAL_SOURCE.index,
                ..Default::default()
            };

            // OOM/capacity: Zig aborts; port keeps fire-and-forget
            let _ = self.graph.input_files.append(crate::Graph::InputFile {
                source: server_source,
                loader: Loader::Js,
                side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
                ..Default::default()
            }); // PERF(port): was assume_capacity
            // OOM/capacity: Zig aborts; port keeps fire-and-forget
            let _ = self.graph.input_files.append(crate::Graph::InputFile {
                source: client_source,
                loader: Loader::Js,
                side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
                ..Default::default()
            }); // PERF(port): was assume_capacity

            debug_assert!(
                self.graph.input_files.items_source()[Index::BAKE_SERVER_DATA.get() as usize]
                    .index
                    .0
                    == Index::BAKE_SERVER_DATA.get()
            );
            debug_assert!(
                self.graph.input_files.items_source()[Index::BAKE_CLIENT_DATA.get() as usize]
                    .index
                    .0
                    == Index::BAKE_CLIENT_DATA.get()
            );

            let _ = self.graph.ast.append(JSAst::empty()); // PERF(port): was assume_capacity
            let _ = self.graph.ast.append(JSAst::empty()); // PERF(port): was assume_capacity
            Ok(())
        }

        // See barrel_imports.rs for barrel optimization implementation.
        // PORT NOTE: Zig `pub usingnamespace`-style method aliases. `pub use` is not
        // permitted in `impl` blocks; the underlying fns live in `barrel_imports` and
        // take `&mut BundleV2` directly — callers reach them as free functions.
        // (was: pub use barrel_imports::{apply_barrel_optimization, schedule_barrel_deferred_imports})

        /// Returns true when barrel optimization is enabled. Barrel optimization
        /// can apply to any package with sideEffects: false or listed in
        /// optimize_imports, so it is always enabled during bundling.
        fn is_barrel_optimization_enabled(&self) -> bool {
            true
        }

        // TODO: remove ResolveQueue
        //
        // Moving this to the Bundle thread was a significant perf improvement on Linux for first builds
        //
        // The problem is that module resolution has many mutexes.
        // The downside is cached resolutions are faster to do in threads since they only lock very briefly.
        #[cold]
        fn run_resolution_for_parse_task(
            parse_result: &mut parse_task::Result,
            this: &mut BundleV2,
        ) -> ResolveQueue {
            let result = match &mut parse_result.value {
                parse_task::ResultValue::Success(r) => r,
                _ => unreachable!(),
            };
            // Capture these before resolveImportRecords, since on error we overwrite
            // parse_result.value (invalidating the `result` pointer).
            let source_index = result.source.index;
            let target = result.ast.target;
            let mut resolve_result = this.resolve_import_records(ResolveImportRecordCtx {
                import_records: &mut result.ast.import_records,
                source: &result.source,
                loader: result.loader,
                target,
            });

            if let Some(err) = resolve_result.last_error {
                bun_core::scoped_log!(Bundle, "failed with error: {}", err.name());
                resolve_result.resolve_queue.clear();

                // Preserve the parsed import_records on the graph so any plugin
                // onResolve tasks already dispatched for *other* records in this
                // same file can still dereference
                // `graph.ast.items(.import_records)[importer_source_index]` when
                // they complete. Without this, the graph entry stays at
                // JSAst.empty and the deferred plugin callback index-out-of-
                // bounds crashes in BundleV2.onResolve / runResolver. The linker
                // never runs because `transpiler.log.errors > 0` aborts the
                // build before link time, so saving the AST is safe.
                this.graph.ast.items_import_records_mut()[source_index.0 as usize] =
                    core::mem::take(&mut result.ast.import_records);

                parse_result.value = parse_task::ResultValue::Err(parse_task::ResultError {
                    err,
                    step: crate::parse_task::Step::Resolve,
                    log: bun_ast::Log::init(),
                    source_index: bun_ast::Index(source_index.0),
                    target,
                });
            }

            resolve_result.resolve_queue
        }
    }

    pub struct ResolveImportRecordCtx<'a> {
        pub import_records: &'a mut import_record::List,
        pub source: &'a bun_ast::Source,
        pub loader: Loader,
        pub target: options::Target,
    }

    pub struct ResolveImportRecordResult {
        pub resolve_queue: ResolveQueue,
        pub last_error: Option<Error>,
    }

    impl<'a> BundleV2<'a> {
        /// Resolve all unresolved import records for a module. Skips records that
        /// are already resolved (valid source_index), unused, or internal.
        /// Returns a resolve queue of new modules to schedule, plus any fatal error.
        /// Used by both initial parse resolution and barrel un-deferral.
        #[cold]
        pub fn resolve_import_records(
            &mut self,
            ctx: ResolveImportRecordCtx,
        ) -> ResolveImportRecordResult {
            let source = ctx.source;
            let loader = ctx.loader;
            let source_dir = source.path.source_dir();
            let mut estimated_resolve_queue_count: usize = 0;
            for import_record in ctx.import_records.slice_mut() {
                if import_record
                    .flags
                    .contains(bun_ast::ImportRecordFlags::IS_INTERNAL)
                {
                    import_record.tag = bun_ast::ImportRecordTag::Runtime;
                    import_record.source_index = Index::RUNTIME;
                }

                // For non-dev-server builds, barrel-deferred records need their
                // source_index cleared so they don't get linked. For dev server,
                // skip this — is_unused is also set by ConvertESMExportsForHmr
                // deduplication, and clearing those source_indices breaks module
                // identity (e.g., __esModule on ESM namespace objects).
                if import_record
                    .flags
                    .contains(bun_ast::ImportRecordFlags::IS_UNUSED)
                    && self.dev_server.is_none()
                {
                    import_record.source_index = Index::INVALID;
                }

                estimated_resolve_queue_count += (!(import_record
                    .flags
                    .contains(bun_ast::ImportRecordFlags::IS_INTERNAL)
                    || import_record
                        .flags
                        .contains(bun_ast::ImportRecordFlags::IS_UNUSED)
                    || import_record.source_index.is_valid()))
                    as usize;
            }
            let mut resolve_queue = ResolveQueue::default();
            resolve_queue.reserve(estimated_resolve_queue_count);

            let mut last_error: Option<Error> = None;

            'outer: for (i, import_record) in ctx.import_records.slice_mut().iter_mut().enumerate()
            {
                // Preserve original import specifier before resolution modifies path
                if import_record.original_path.is_empty() {
                    import_record.original_path = import_record.path.text;
                }

                if
                // Don't resolve TypeScript types
                import_record.flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED)
                // Don't resolve the runtime
                || import_record.flags.contains(bun_ast::ImportRecordFlags::IS_INTERNAL)
                // Don't resolve pre-resolved imports
                || import_record.source_index.is_valid()
                {
                    continue;
                }

                if let Some(fw) = &self.framework {
                    if fw.server_components.is_some() {
                        // PERF(port): was comptime bool dispatch — profile in Phase B
                        let is_server = ctx.target.is_server_side();
                        let src = if is_server {
                            &bake::SERVER_VIRTUAL_SOURCE
                        } else {
                            &bake::CLIENT_VIRTUAL_SOURCE
                        };
                        if import_record.path.text == src.path.pretty {
                            if self.dev_server.is_some() {
                                import_record.flags.insert(
                                    bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS,
                                );
                                import_record.source_index = Index::INVALID;
                            } else {
                                if is_server {
                                    self.graph.kit_referenced_server_data = true;
                                } else {
                                    self.graph.kit_referenced_client_data = true;
                                }
                                import_record.path.namespace = b"bun";
                                import_record.source_index = Index::source(src.index.0);
                            }
                            continue;
                        }
                    }
                }

                if import_record.path.text == b"bun:wrap" {
                    import_record.path.namespace = b"bun";
                    import_record.tag = bun_ast::ImportRecordTag::Runtime;
                    import_record.path.text = b"wrap";
                    import_record.source_index = Index::RUNTIME;
                    continue;
                }

                if ctx.target.is_bun() {
                    if let Some(replacement) = bun_resolve_builtins::HardcodedModule::Alias::get(
                        &import_record.path.text,
                        Target::Bun,
                        bun_resolve_builtins::HardcodedModule::Cfg {
                            rewrite_jest_for_tests: self.transpiler.options.rewrite_jest_for_tests,
                        },
                    ) {
                        // When bundling node builtins, remove the "node:" prefix.
                        // This supports special use cases where the bundle is put
                        // into a non-node module resolver that doesn't support
                        // node's prefix. https://github.com/oven-sh/bun/issues/18545
                        import_record.path.text =
                            if replacement.node_builtin && !replacement.node_only_prefix {
                                &replacement.path.as_bytes()[5..]
                            } else {
                                replacement.path.as_bytes()
                            };
                        import_record.tag = replacement.tag;
                        import_record.source_index = Index::INVALID;
                        import_record
                            .flags
                            .insert(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                        continue;
                    }

                    if import_record.path.text.starts_with(b"bun:") {
                        let new_text: &'static [u8] = &import_record.path.text[b"bun:".len()..];
                        import_record.path = bun_paths::fs::Path::init(new_text);
                        import_record.path.namespace = b"bun";
                        import_record.source_index = Index::INVALID;
                        import_record
                            .flags
                            .insert(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);

                        // don't link bun
                        continue;
                    }
                }

                // By default, we treat .sqlite files as external.
                if import_record.loader == Some(Loader::Sqlite) {
                    import_record
                        .flags
                        .insert(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                    continue;
                }

                if import_record.loader == Some(Loader::SqliteEmbedded) {
                    import_record
                        .flags
                        .insert(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                }

                if self.enqueue_on_resolve_plugin_if_needed(
                    source.index.0,
                    import_record,
                    &source.path.text,
                    i as u32,
                    ctx.target,
                ) {
                    continue;
                }

                // PORT NOTE: borrowck — `transpiler_for_target` returns `&mut Transpiler`
                // tied to `&mut self`, but the underlying storage is raw `*mut Transpiler`
                // backrefs valid for `'a` (see `init`). Compute the raw ptr first, then
                // deref once, so the `&mut self` borrow doesn't span the rest of the loop
                // body (Zig held all of these as raw ptrs and aliased freely).
                let (transpiler_ptr, bake_graph, target): (
                    *mut Transpiler<'a>,
                    bake::Graph,
                    options::Target,
                ) = if import_record.tag == bun_ast::ImportRecordTag::BakeResolveToSsrGraph {
                    if self.framework.is_none() {
                        self.log_for_resolution_failures(&source.path.text, bake::Graph::Ssr).add_error_fmt(
                            Some(source),
                            import_record.range.loc,
                            format_args!("The 'bunBakeGraph' import attribute cannot be used outside of a Bun Bake bundle"),
                        );
                        continue;
                    }

                    let is_supported = self.framework.as_ref().unwrap().server_components.is_some()
                        && self
                            .framework
                            .as_ref()
                            .unwrap()
                            .server_components
                            .as_ref()
                            .unwrap()
                            .separate_ssr_graph;
                    if !is_supported {
                        self.log_for_resolution_failures(&source.path.text, bake::Graph::Ssr).add_error_fmt(
                            Some(source),
                            import_record.range.loc,
                            format_args!("Framework does not have a separate SSR graph to put this import into"),
                        );
                        continue;
                    }

                    (
                        self.ssr_transpiler,
                        bake::Graph::Ssr,
                        Target::BakeServerComponentsSsr,
                    )
                } else {
                    (
                        std::ptr::from_mut::<Transpiler<'a>>(
                            self.transpiler_for_target(ctx.target),
                        ),
                        ctx.target.bake_graph(),
                        ctx.target,
                    )
                };
                // SAFETY: see PORT NOTE above — raw `*mut Transpiler` lives for `'a`.
                let transpiler: &mut Transpiler<'a> = unsafe { &mut *transpiler_ptr };

                // Check the FileMap first for in-memory files
                if let Some(file_map) = self.file_map {
                    if let Some(_file_map_result) =
                        file_map.resolve(self.arena(), &source.path.text, &import_record.path.text)
                    {
                        let mut file_map_result = _file_map_result;
                        let mut path_primary = file_map_result.path_pair.primary.clone();
                        let import_record_loader = import_record.loader.unwrap_or_else(|| {
                            Fs::Path::init(path_primary.text)
                                .loader(&transpiler.options.loaders)
                                .unwrap_or(Loader::File)
                        });
                        import_record.loader = Some(import_record_loader);

                        if let Some(id) = self
                            .path_to_source_index_map(target)
                            .get(&path_primary.text)
                        {
                            import_record.source_index = Index::init(id);
                            continue;
                        }

                        let resolve_entry =
                            resolve_queue.get_or_put(&path_primary.text).expect("oom");
                        if resolve_entry.found_existing {
                            import_record.path =
                                path_as_static(unsafe { &**resolve_entry.value_ptr }.path.clone());
                            continue;
                        }

                        // For virtual files, use the path text as-is (no relative path computation needed).
                        // SAFETY: arena outlives the bundle pass; raw-pointer detour erases the
                        // `&self` lifetime so the resulting `&'static [u8]` doesn't pin `self`
                        // (otherwise `path_primary: Path<'static>` forces `&self: 'static`,
                        // cascading borrow conflicts into every `&mut self` call below).
                        path_primary.pretty = unsafe {
                            bun_ptr::detach_lifetime(
                                self.arena().alloc_slice_copy(&path_primary.text),
                            )
                        };
                        import_record.path = path_as_static(path_primary.clone());
                        let _ = path_primary.text; // key already interned by get_or_put
                        bun_core::scoped_log!(
                            Bundle,
                            "created ParseTask from FileMap: {}",
                            bstr::BStr::new(&path_primary.text)
                        );
                        file_map_result.path_pair.primary = path_primary;
                        // Arena-owned (Zig: `arena.create(ParseTask)`).
                        let resolve_task_val =
                            ParseTask::init(&file_map_result, bun_ast::Index::INVALID, self);
                        // SAFETY: arena outlives the bundle pass.
                        let resolve_task: &mut ParseTask = self.arena_create(resolve_task_val);
                        resolve_task.known_target = target;
                        // Use transpiler JSX options, applying force_node_env like the disk path does
                        resolve_task.jsx = transpiler.options.jsx.clone();
                        resolve_task.jsx.development = match transpiler.options.force_node_env {
                            options::ForceNodeEnv::Development => true,
                            options::ForceNodeEnv::Production => false,
                            options::ForceNodeEnv::Unspecified => {
                                transpiler.options.jsx.development
                            }
                        };
                        resolve_task.loader = Some(import_record_loader);
                        resolve_task.tree_shaking = transpiler.options.tree_shaking;
                        resolve_task.side_effects = bun_ast::SideEffects::HasSideEffects;
                        *resolve_entry.value_ptr = resolve_task;
                        continue;
                    }
                }

                let mut had_busted_dir_cache = false;
                let resolve_result: _resolver::Result = 'inner: loop {
                    match transpiler.resolver.resolve_with_framework(
                        source_dir,
                        &import_record.path.text,
                        import_record.kind,
                    ) {
                        Ok(r) => break r,
                        Err(err) => {
                            // PORT NOTE: borrowck — `log_for_resolution_failures` returns
                            // `&mut Log` tied to `&mut self`, but it's always a raw-ptr
                            // deref (DevServer vtable or `transpiler.log`). Detach via
                            // `*mut` so later `self.*` reads don't conflict.
                            let log: &mut bun_ast::Log = unsafe {
                                &mut *std::ptr::from_mut::<bun_ast::Log>(
                                    self.log_for_resolution_failures(&source.path.text, bake_graph),
                                )
                            };

                            // Only perform directory busting when hot-reloading is enabled
                            if err == bun_core::err!("ModuleNotFound") {
                                if self.bun_watcher.is_some() {
                                    if !had_busted_dir_cache {
                                        bun_core::scoped_log!(
                                            watcher,
                                            "busting dir cache {} -> {}",
                                            bstr::BStr::new(&source.path.text),
                                            bstr::BStr::new(&import_record.path.text)
                                        );
                                        // Only re-query if we previously had something cached.
                                        if transpiler.resolver.bust_dir_cache_from_specifier(
                                            &source.path.text,
                                            &import_record.path.text,
                                        ) {
                                            had_busted_dir_cache = true;
                                            continue 'inner;
                                        }
                                    }
                                    if let Some(dev) = self.dev_server {
                                        // Tell DevServer about the resolution failure.
                                        dev.track_resolution_failure(
                                            &source.path.text,
                                            &import_record.path.text,
                                            ctx.target.bake_graph(), // use the source file target not the altered one
                                            loader,
                                        )
                                        .expect("oom");
                                    }
                                }
                            }

                            // Disable failing packages from being printed.
                            // This may cause broken code to write.
                            // However, doing this means we tell them all the resolve errors
                            // Rather than just the first one.
                            import_record.path.is_disabled = true;

                            if err == bun_core::err!("ModuleNotFound") {
                                let add_error = bun_ast::Log::add_resolve_error_with_text_dupe;

                                if !import_record
                                    .flags
                                    .contains(bun_ast::ImportRecordFlags::HANDLES_IMPORT_ERRORS)
                                    && !self.transpiler.options.ignore_module_resolution_errors
                                {
                                    last_error = Some(err);
                                    if is_package_path(&import_record.path.text) {
                                        if ctx.target == Target::Browser
                                            && options::is_node_builtin(&import_record.path.text)
                                        {
                                            add_error(
                                                log,
                                                Some(source),
                                                import_record.range,
                                                format_args!(
                                                    "Browser build cannot {} Node.js builtin: \"{}\"{}",
                                                    bstr::BStr::new(
                                                        import_record.kind.error_label()
                                                    ),
                                                    bstr::BStr::new(&import_record.path.text),
                                                    if self.dev_server.is_none() {
                                                        ". To use Node.js builtins, set target to 'node' or 'bun'"
                                                    } else {
                                                        ""
                                                    },
                                                ),
                                                &import_record.path.text,
                                                import_record.kind.into(),
                                            );
                                        } else if !ctx.target.is_bun()
                                            && import_record.path.text == b"bun"
                                        {
                                            add_error(
                                                log,
                                                Some(source),
                                                import_record.range,
                                                format_args!(
                                                    "Browser build cannot {} Bun builtin: \"{}\"{}",
                                                    bstr::BStr::new(
                                                        import_record.kind.error_label()
                                                    ),
                                                    bstr::BStr::new(&import_record.path.text),
                                                    if self.dev_server.is_none() {
                                                        ". When bundling for Bun, set target to 'bun'"
                                                    } else {
                                                        ""
                                                    },
                                                ),
                                                &import_record.path.text,
                                                import_record.kind.into(),
                                            );
                                        } else if !ctx.target.is_bun()
                                            && import_record.path.text.starts_with(b"bun:")
                                        {
                                            add_error(
                                                log,
                                                Some(source),
                                                import_record.range,
                                                format_args!(
                                                    "Browser build cannot {} Bun builtin: \"{}\"{}",
                                                    bstr::BStr::new(
                                                        import_record.kind.error_label()
                                                    ),
                                                    bstr::BStr::new(&import_record.path.text),
                                                    if self.dev_server.is_none() {
                                                        ". When bundling for Bun, set target to 'bun'"
                                                    } else {
                                                        ""
                                                    },
                                                ),
                                                &import_record.path.text,
                                                import_record.kind.into(),
                                            );
                                        } else {
                                            add_error(
                                                log,
                                                Some(source),
                                                import_record.range,
                                                format_args!(
                                                    "Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                                                    bstr::BStr::new(&import_record.path.text)
                                                ),
                                                &import_record.path.text,
                                                import_record.kind.into(),
                                            );
                                        }
                                    } else {
                                        let mut buf = bun_paths::path_buffer_pool::get();
                                        let specifier_to_use: &[u8] = if loader == Loader::Html
                                            && import_record.path.text.starts_with(
                                                &Fs::FileSystem::instance().top_level_dir,
                                            ) {
                                            let specifier_to_use = &import_record.path.text
                                                [Fs::FileSystem::instance().top_level_dir.len()..];
                                            #[cfg(windows)]
                                            {
                                                &*bun_paths::resolve_path::path_to_posix_buf::<u8>(
                                                    specifier_to_use,
                                                    &mut *buf,
                                                )
                                            }
                                            #[cfg(not(windows))]
                                            {
                                                specifier_to_use
                                            }
                                        } else {
                                            &import_record.path.text
                                        };
                                        add_error(
                                            log,
                                            Some(source),
                                            import_record.range,
                                            format_args!(
                                                "Could not resolve: \"{}\"",
                                                bstr::BStr::new(specifier_to_use)
                                            ),
                                            specifier_to_use,
                                            import_record.kind.into(),
                                        );
                                    }
                                }
                            } else {
                                // assume other errors are already in the log
                                last_error = Some(err);
                            }
                            continue 'outer;
                        }
                    }
                };
                let mut resolve_result = resolve_result;
                // if there were errors, lets go ahead and collect them all
                if last_error.is_some() {
                    continue;
                }

                // PORT NOTE: borrowck — Zig `Result.path()` returns `?*Path` (raw),
                // letting the loop body keep reading other `resolve_result` fields
                // (`.flags`, `.path_pair`, `.primary_side_effects_data`, `.jsx`).
                // The Rust port returns `Option<&mut Path>`, which would lock the
                // whole struct. Detach via raw ptr to mirror the Zig aliasing.
                let path: &mut Fs::Path = match resolve_result.path() {
                    Some(p) => unsafe { bun_ptr::detach_lifetime_mut::<Fs::Path>(p) },
                    None => {
                        import_record.path.is_disabled = true;
                        import_record.source_index = Index::INVALID;
                        continue;
                    }
                };

                if resolve_result.flags.is_external() {
                    if resolve_result.flags.is_external_and_rewrite_import_path()
                        && !strings::eql_long(
                            &resolve_result.path_pair.primary.text,
                            &import_record.path.text,
                            true,
                        )
                    {
                        import_record.path =
                            path_as_static(resolve_result.path_pair.primary.clone());
                    }
                    import_record.flags.set(
                        bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS,
                        resolve_result.primary_side_effects_data
                            != bun_ast::SideEffects::HasSideEffects,
                    );
                    continue;
                }

                if let Some(dev_server) = self.dev_server_handle() {
                    'brk: {
                        if path.loader(&self.transpiler.options.loaders) == Some(Loader::Html)
                            && (import_record.loader.is_none()
                                || import_record.loader.unwrap() == Loader::Html)
                        {
                            // This use case is currently not supported. This error
                            // blocks an assertion failure because the DevServer
                            // reserves the HTML file's spot in IncrementalGraph for the
                            // route definition.
                            let log =
                                self.log_for_resolution_failures(&source.path.text, bake_graph);
                            log.add_range_error_fmt(
                                Some(source),
                                import_record.range,
                                format_args!("Browser builds cannot import HTML files."),
                            );
                            continue 'outer;
                        }

                        if loader == Loader::Css {
                            // Do not use cached files for CSS.
                            break 'brk;
                        }

                        import_record.source_index = Index::INVALID;

                        if let Some(entry) = dev_server.is_file_cached(&path.text, bake_graph) {
                            let rel = bun_paths::resolve_path::relative_platform::<
                                bun_paths::resolve_path::platform::Loose,
                                false,
                            >(
                                self.transpiler.fs().top_level_dir, &path.text
                            );
                            if loader == Loader::Html && entry.kind == bake_types::CacheKind::Asset
                            {
                                // Overload `path.text` to point to the final URL
                                // This information cannot be queried while printing because a lock wouldn't get held.
                                let hash = dev_server
                                    .asset_hash(&path.text)
                                    .expect("cached asset not found");
                                import_record.path.text = path.text;
                                import_record.path.namespace = b"file";
                                // SAFETY: `alloc_str` returns into the bundler arena which
                                // outlives this `ImportRecord`. See `interned_slice` contract.
                                import_record.path.pretty = unsafe {
                                    interned_slice(
                                        self.arena()
                                            .alloc_str(&format!(
                                                "{}/{:016x}{}",
                                                bake_types::ASSET_PREFIX,
                                                hash,
                                                bstr::BStr::new(bun_paths::extension(&path.text)),
                                            ))
                                            .as_bytes(),
                                    )
                                };
                                import_record.path.is_disabled = false;
                            } else {
                                import_record.path.text = path.text;
                                import_record.path.pretty = rel.into();
                                import_record.path = path_as_static(
                                    self.path_with_pretty_initialized(path.clone(), target)
                                        .expect("oom"),
                                );
                                if loader == Loader::Html
                                    || entry.kind == bake_types::CacheKind::Css
                                {
                                    import_record.path.is_disabled = true;
                                }
                            }
                            continue 'outer;
                        }
                    }
                }

                let import_record_loader = 'brk: {
                    let resolved_loader = import_record.loader.unwrap_or_else(|| {
                        path.loader(&transpiler.options.loaders)
                            .unwrap_or(Loader::File)
                    });
                    // When an HTML file references a URL asset (e.g. <link rel="manifest" href="./manifest.json" />),
                    // the file must be copied to the output directory as-is. If the resolved loader would
                    // parse/transform the file (e.g. .json, .toml) rather than copy it, force the .file loader
                    // so that `shouldCopyForBundling()` returns true and the asset is emitted.
                    // Only do this for HTML sources — CSS url() imports should retain their original behavior.
                    if loader == Loader::Html
                        && import_record.kind == ImportKind::Url
                        && !resolved_loader.should_copy_for_bundling()
                        && !resolved_loader.is_javascript_like()
                        && !resolved_loader.is_css()
                        && resolved_loader != Loader::Html
                    {
                        break 'brk Loader::File;
                    }
                    break 'brk resolved_loader;
                };
                import_record.loader = Some(import_record_loader);

                let is_html_entrypoint = import_record_loader == Loader::Html
                    && target.is_server_side()
                    && self.dev_server.is_none();

                if let Some(id) = self.path_to_source_index_map(target).get(&path.text) {
                    if self.dev_server.is_some() && loader != Loader::Html {
                        import_record.path = self.graph.input_files.items_source()[id as usize]
                            .path
                            .clone();
                    } else {
                        import_record.source_index = Index::init(id);
                    }
                    continue;
                }

                if is_html_entrypoint {
                    import_record.kind = ImportKind::HtmlManifest;
                }

                let resolve_entry = resolve_queue.get_or_put(&path.text).expect("oom");
                if resolve_entry.found_existing {
                    import_record.path =
                        path_as_static(unsafe { &**resolve_entry.value_ptr }.path.clone());
                    continue;
                }

                *path = self
                    .path_with_pretty_initialized(core::mem::take(path), target)
                    .expect("oom");

                import_record.path = path_as_static(path.clone());
                // key already interned by get_or_put — no key_ptr on StringHashMapGetOrPut
                bun_core::scoped_log!(Bundle, "created ParseTask: {}", bstr::BStr::new(&path.text));
                // Arena-owned (Zig: `arena.create(ParseTask)`).
                let resolve_task_val =
                    ParseTask::init(&resolve_result, bun_ast::Index::INVALID, self);
                // SAFETY: arena outlives the bundle pass.
                let resolve_task: &mut ParseTask = self.arena_create(resolve_task_val);

                resolve_task.known_target = if import_record.kind == ImportKind::HtmlManifest {
                    Target::Browser
                } else {
                    target
                };

                resolve_task.jsx = resolve_result.jsx.clone().into();
                resolve_task.jsx.development = match transpiler.options.force_node_env {
                    options::ForceNodeEnv::Development => true,
                    options::ForceNodeEnv::Production => false,
                    options::ForceNodeEnv::Unspecified => transpiler.options.jsx.development,
                };

                resolve_task.loader = Some(import_record_loader);
                resolve_task.tree_shaking = transpiler.options.tree_shaking;
                *resolve_entry.value_ptr = resolve_task;
                if let Some(secondary) = &resolve_result.path_pair.secondary {
                    if !secondary.is_disabled
                        && !core::ptr::eq(secondary, path)
                        && !strings::eql_long(&secondary.text, &path.text, true)
                    {
                        resolve_task.secondary_path_for_commonjs_interop = Some(secondary.clone());
                    }
                }

                if is_html_entrypoint {
                    self.generate_server_html_module(path, target, import_record, &path.text)
                        .expect("unreachable");
                }
            }

            ResolveImportRecordResult {
                resolve_queue,
                last_error,
            }
        }

        /// Process a resolve queue: create input file slots and schedule parse tasks.
        /// Returns the number of newly scheduled tasks (for pending_items accounting).
        #[cold]
        pub fn process_resolve_queue(
            &mut self,
            resolve_queue: ResolveQueue,
            target: options::Target,
            importer_source_index: IndexInt,
        ) -> i32 {
            let mut diff: i32 = 0;
            // PORT NOTE: reshaped for borrowck — Zig freely aliased `graph` and the
            // path map across the loop body. Here we (a) capture a raw self ptr for
            // ParseTask.ctx, (b) hoist dev_server check, and (c) scope the map
            // borrow to the get_or_put so later `self.graph.*` writes don't overlap.
            // SAFETY: write provenance from `ptr::from_mut`; outlives every ParseTask.
            let self_ptr: Option<bun_ptr::ParentRef<BundleV2<'static>>> = Some(unsafe {
                bun_ptr::ParentRef::from_raw_mut(
                    std::ptr::from_mut::<Self>(self).cast::<BundleV2<'static>>(),
                )
            });
            let dev_server_is_none = self.dev_server.is_none();
            for (key, value) in resolve_queue.iter() {
                let value: *mut ParseTask = *value;
                // SAFETY: ParseTask was arena-allocated in `resolve_import_records`;
                // the arena outlives this loop.
                let value = unsafe { &mut *value };
                let loader = value.loader.unwrap_or_else(|| {
                    value
                        .path
                        .loader(&self.transpiler.options.loaders)
                        .unwrap_or(Loader::File)
                });
                let is_html_entrypoint =
                    loader == Loader::Html && target.is_server_side() && dev_server_is_none;
                // Select map and perform get_or_put, capturing the slot as a raw ptr
                // so the &mut on self.graph is released before we touch other fields.
                let (found_existing, value_ptr): (bool, *mut IndexInt) = {
                    let map: &mut PathToSourceIndexMap = if is_html_entrypoint {
                        self.graph.path_to_source_index_map(Target::Browser)
                    } else {
                        self.graph.path_to_source_index_map(target)
                    };
                    let existing = map.get_or_put(&key).expect("oom");
                    (
                        existing.found_existing,
                        std::ptr::from_mut::<IndexInt>(existing.value_ptr),
                    )
                };

                if !found_existing {
                    let new_task: &mut ParseTask = value;
                    let mut new_input_file = crate::Graph::InputFile {
                        source: bun_ast::Source::init_empty_file(&new_task.path.text[..]),
                        side_effects: new_task.side_effects,
                        secondary_path: if let Some(secondary_path) =
                            &new_task.secondary_path_for_commonjs_interop
                        {
                            secondary_path.text.into()
                        } else {
                            Box::default()
                        },
                        ..Default::default()
                    };

                    self.graph.has_any_secondary_paths = self.graph.has_any_secondary_paths
                        || !new_input_file.secondary_path.is_empty();

                    new_input_file.source.index =
                        bun_ast::Index(self.graph.input_files.len() as u32);
                    new_input_file.source.path = path_as_static(new_task.path.clone());
                    new_input_file.loader = loader;
                    let new_source_index: u32 = new_input_file.source.index.0;
                    new_task.source_index = bun_ast::Index(new_source_index);
                    new_task.ctx = self_ptr;
                    // SAFETY: value_ptr points into PathToSourceIndexMap storage; no
                    // intervening insert into that map has occurred since get_or_put.
                    unsafe {
                        *value_ptr = new_task.source_index.get();
                    }

                    diff += 1;

                    self.graph
                        .input_files
                        .append(new_input_file)
                        .expect("unreachable");
                    let _ = self.graph.ast.append(JSAst::empty()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

                    if is_html_entrypoint {
                        self.ensure_client_transpiler();
                        self.graph
                            .entry_points
                            .push(bun_ast::Index(new_source_index));
                    }

                    if self.enqueue_on_load_plugin_if_needed(new_task) {
                        continue;
                    }

                    if loader.should_copy_for_bundling() {
                        let additional_files: &mut Vec<crate::AdditionalFile> =
                            &mut self.graph.input_files.items_additional_files_mut()
                                [importer_source_index as usize];
                        additional_files.push(crate::AdditionalFile::SourceIndex(
                            new_task.source_index.get(),
                        ));
                        self.graph.input_files.items_side_effects_mut()
                            [new_task.source_index.get() as usize] =
                            bun_ast::SideEffects::NoSideEffectsPureData;
                        self.graph.estimated_file_loader_count += 1;
                    }

                    self.graph.pool().schedule(new_task);
                } else {
                    if loader.should_copy_for_bundling() {
                        // SAFETY: value_ptr is valid (see above).
                        let existing_idx = unsafe { *value_ptr };
                        let additional_files: &mut Vec<crate::AdditionalFile> =
                            &mut self.graph.input_files.items_additional_files_mut()
                                [importer_source_index as usize];
                        additional_files.push(crate::AdditionalFile::SourceIndex(existing_idx));
                        self.graph.estimated_file_loader_count += 1;
                    }

                    // ParseTask is arena-allocated; the slab itself is reclaimed on
                    // arena reset, but its heap-owned fields (path/jsx clones) need
                    // their destructors run now (Zig: `value.deinit()`).
                    // SAFETY: `value` is a live arena slot; not used after this.
                    unsafe { core::ptr::drop_in_place(value) };
                }
            }
            diff
        }
    }

    /// Argument struct for `patch_import_record_source_indices` — pulled out so the
    /// borrow of `import_records` (a column of `graph.ast`) doesn't overlap the
    /// `&mut self` the body needs for `path_to_source_index_map`.
    #[derive(Clone, Copy)]
    pub struct PatchImportRecordsCtx<'a> {
        pub source_index: Index,
        pub source_path: &'a [u8],
        pub loader: Loader,
        pub target: options::Target,
        pub redirect_import_record_index: u32,
        /// When true, always save source indices regardless of dev_server/loader.
        /// Used for barrel un-deferral where records must always be connected.
        pub force_save: bool,
    }

    impl Default for PatchImportRecordsCtx<'_> {
        fn default() -> Self {
            Self {
                source_index: Index::INVALID,
                source_path: b"",
                loader: Loader::File,
                target: Target::Browser,
                redirect_import_record_index: u32::MAX,
                force_save: false,
            }
        }
    }

    impl<'a> BundleV2<'a> {
        /// Patch source_index on import records from pathToSourceIndexMap and
        /// resolve_tasks_waiting_for_import_source_index. Called after
        /// processResolveQueue has registered new modules.
        #[cold]
        pub fn patch_import_record_source_indices(
            &mut self,
            import_records: &mut import_record::List,
            ctx: PatchImportRecordsCtx,
        ) {
            // PORT NOTE: Zig aliased `const graph = &this.graph;`. Borrowck rejects
            // holding that across the `&mut self.graph.build_graphs[...]` borrow
            // below, so address the disjoint `self.graph.*` fields directly instead.
            let input_file_loaders = self.graph.input_files.items_loader();
            let save_import_record_source_index = ctx.force_save
                || self.dev_server.is_none()
                || ctx.loader == Loader::Html
                || ctx.loader.is_css();

            if let Some(idx) = self
                .resolve_tasks_waiting_for_import_source_index
                .get_index(&ctx.source_index.get())
            {
                let (_, value) = self
                    .resolve_tasks_waiting_for_import_source_index
                    .swap_remove_at(idx);
                for to_assign in value.slice() {
                    if save_import_record_source_index
                        || input_file_loaders[to_assign.to_source_index.get() as usize].is_css()
                    {
                        import_records.slice_mut()[to_assign.import_record_index as usize]
                            .source_index = to_assign.to_source_index;
                    }
                }
                drop(value);
            }

            // Inlined `self.path_to_source_index_map(ctx.target)` (== `&mut self.graph.build_graphs[target]`)
            // so borrowck sees it as disjoint from `self.graph.input_files` above.
            let path_to_source_index_map = &mut self.graph.build_graphs[ctx.target];
            for (i, record) in import_records.slice_mut().iter_mut().enumerate() {
                if let Some(source_index) = path_to_source_index_map.get_path(&record.path) {
                    if save_import_record_source_index
                        || input_file_loaders[source_index as usize].is_css()
                    {
                        record.source_index.0 = source_index;
                    }

                    if let Some(compare) = get_redirect_id(ctx.redirect_import_record_index) {
                        if compare == i as u32 {
                            let _ =
                                path_to_source_index_map.put(ctx.source_path.into(), source_index); // OOM-only Result (Zig: catch unreachable)
                        }
                    }
                }
            }
        }

        #[cold]
        fn generate_server_html_module(
            &mut self,
            path: &Fs::Path,
            target: options::Target,
            import_record: &mut ImportRecord,
            path_text: &[u8],
        ) -> Result<(), Error> {
            // 1. Create the ast right here
            // 2. Create a separate "virutal" module that becomes the manifest later on.
            // 3. Add it to the graph
            // PORT NOTE: Zig aliased `graph = &this.graph;` — re-borrow `self.graph`
            // at each use so the `self.*` method calls below don't conflict.
            let empty_html_file_source = bun_ast::Source {
                path: path_as_static(path.clone()),
                index: bun_ast::Index(self.graph.input_files.len() as u32),
                contents: std::borrow::Cow::Borrowed(&b""[..]),
                ..Default::default()
            };
            let mut js_parser_options = bun_js_parser::ParserOptions::init(
                self.transpiler_for_target(target)
                    .options
                    .jsx
                    .clone()
                    .into(),
                Loader::Html,
            );
            js_parser_options.bundle = true;

            // SAFETY: `alloc_str` returns a `&mut str` into the bundler arena, which
            // outlives this AST. `E::EString.data` is `&'static [u8]` per the Phase-A
            // arena-erasure convention. See `interned_slice` contract.
            let unique_key: &'static [u8] = unsafe {
                interned_slice(
                    self.arena()
                        .alloc_str(&format!(
                            "{}",
                            chunk::UniqueKey {
                                prefix: self.unique_key,
                                kind: chunk::QueryKind::HtmlImport,
                                index: self.graph.html_imports.server_source_indices.len() as u32,
                            },
                        ))
                        .as_bytes(),
                )
            };

            // Extract raw pointers so the `&mut self` borrow from
            // `transpiler_for_target` doesn't overlap `self.arena()` below.
            // SAFETY: `define`/`log` live for `'a` (owned by the Transpiler /
            // BACKREF set in `BundleV2::init`).
            let (define_ptr, log_ptr): (*mut bun_js_parser::Define, *mut bun_ast::Log) = {
                let transpiler = self.transpiler_for_target(target);
                (&raw mut *transpiler.options.define, transpiler.log)
            };

            let ast_for_html_entrypoint = JSAst::init(
                bun_js_parser::new_lazy_export_ast(
                    self.arena(),
                    unsafe { &mut *define_ptr },
                    js_parser_options,
                    unsafe { &mut *log_ptr },
                    Expr::init(
                        E::EString {
                            data: unique_key.into(),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    &empty_html_file_source,
                    // We replace this runtime API call's ref later via .link on the Symbol.
                    b"__jsonParse",
                )?
                .unwrap(),
            );

            let fake_input_file = crate::Graph::InputFile {
                source: empty_html_file_source,
                side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
                ..Default::default()
            };

            let fake_source_index = fake_input_file.source.index;
            self.graph.input_files.append(fake_input_file)?;
            let _ = self.graph.ast.append(ast_for_html_entrypoint); // OOM/capacity: Zig aborts; port keeps fire-and-forget

            import_record.source_index = Index::init(fake_source_index.0);
            let _ = self
                .path_to_source_index_map(target)
                .put(path_text.into(), fake_source_index.0); // OOM-only Result (Zig: catch unreachable)
            self.graph
                .html_imports
                .server_source_indices
                .push(fake_source_index.0);
            self.ensure_client_transpiler();
            Ok(())
        }
    }

    impl<'a> BundleV2<'a> {
        pub fn on_notify_defer(&mut self) {
            self.thread_lock.assert_locked();
            self.graph.deferred_pending += 1;
            self.decrement_scan_counter();
        }

        pub fn on_notify_defer_mini(_: &mut jsc_api::JSBundler::Load, this: &mut BundleV2) {
            this.on_notify_defer();
        }

        #[cold]
        pub fn on_parse_task_complete(parse_result: &mut parse_task::Result, this: &mut BundleV2) {
            let _trace = crate::ungate_support::perf::trace("Bundler.onParseTaskComplete");
            // PORT NOTE: Zig aliased `const graph = &this.graph;`. Borrowck rejects
            // holding that across the `this.*` method calls below (each takes
            // `&mut BundleV2`), so re-borrow `this.graph` at each use site instead.
            if parse_result.external.function.is_some() {
                let source = match &parse_result.value {
                    parse_task::ResultValue::Empty { source_index } => source_index.get(),
                    parse_task::ResultValue::Err(data) => data.source_index.get(),
                    parse_task::ResultValue::Success(val) => val.source.index.0,
                };
                let loader: Loader = this.graph.input_files.items_loader()[source as usize];
                // PORT NOTE: `InputFile.arena` column dropped in the Rust port;
                // stash the finalizer regardless so plugin-owned bytes are freed.
                let _ = loader;
                this.finalizers
                    .push(core::mem::take(&mut parse_result.external));
            }

            // defer bun.default_allocator.destroy(parse_result) — caller owns Box and drops at end
            // TODO(port): parse_result is heap-allocated by worker; reconstruct heap::take at scope exit

            let mut diff: i32 = -1;
            // PORT NOTE: Zig used `defer { graph.pending_items += diff; … }` —
            // hoisted to tail position (see end of fn) so the closure doesn't
            // double-borrow `graph`/`this`.

            let mut resolve_queue = ResolveQueue::default();
            let mut process_log = true;

            if matches!(parse_result.value, parse_task::ResultValue::Success(_)) {
                barrel_imports::apply_barrel_optimization(this, parse_result);
                resolve_queue = Self::run_resolution_for_parse_task(parse_result, this);
                if matches!(parse_result.value, parse_task::ResultValue::Err(_)) {
                    process_log = false;
                }
            }

            // To minimize contention, watchers are appended on the bundle thread.
            if this.bun_watcher.is_some() {
                if parse_result.watcher_data.fd != bun_sys::Fd::INVALID {
                    let source_index = match &parse_result.value {
                        parse_task::ResultValue::Empty { source_index } => source_index.get(),
                        parse_task::ResultValue::Err(data) => data.source_index.get(),
                        parse_task::ResultValue::Success(val) => val.source.index.0,
                    };
                    // PORT NOTE: borrowck — read source path/loader before
                    // `should_add_watcher(&self)` so the column borrow is released.
                    let source_path = this.graph.input_files.items_source()[source_index as usize]
                        .path
                        .text;
                    let loader = this.graph.input_files.items_loader()[source_index as usize];
                    if this.should_add_watcher(&source_path) {
                        // PORT NOTE: const generic `CLONE_FILE_PATH = isWindows`
                        // matches `cfg!(windows)` at compile time.
                        let _ = this
                            .bun_watcher_mut()
                            .unwrap()
                            .add_file::<{ cfg!(windows) }>(
                                parse_result.watcher_data.fd,
                                &source_path,
                                bun_wyhash::hash(source_path.as_ref()) as u32,
                                bun_watcher::Loader(loader as u8),
                                parse_result.watcher_data.dir_fd,
                                None,
                            );
                    }
                }
            }

            match &mut parse_result.value {
                parse_task::ResultValue::Empty {
                    source_index: empty_source_index,
                } => {
                    let empty_idx = (*empty_source_index).get() as usize;
                    this.graph.input_files.items_side_effects_mut()[empty_idx] =
                        bun_ast::SideEffects::NoSideEffectsEmptyAst;
                    if cfg!(debug_assertions) {
                        bun_core::scoped_log!(
                            Bundle,
                            "onParse({}, {}) = empty",
                            empty_idx,
                            bstr::BStr::new(
                                &this.graph.input_files.items_source()[empty_idx].path.text
                            )
                        );
                    }
                }
                parse_task::ResultValue::Success(result) => {
                    // SAFETY: `transpiler.log` is a live BACKREF set in BundleV2::init.
                    result
                        .log
                        .clone_to_with_recycled(this.transpiler.log_mut(), true);

                    this.has_any_top_level_await_modules = this.has_any_top_level_await_modules
                        || !result.ast.top_level_await_keyword.is_empty();

                    // Warning: `input_files` and `ast` arrays may resize in this function call
                    // It is not safe to cache slices from them.
                    let result_source_index = result.source.index.0 as usize;
                    core::mem::swap(
                        &mut this.graph.input_files.items_source_mut()[result_source_index],
                        &mut result.source,
                    );
                    // `on_load` (copy-for-bundling path, ~:4414) parks plugin bytes as
                    // `Cow::Owned` directly in this slot and gives the ParseTask a borrowed
                    // alias. The swap just moved that owner into `result.source`; move it
                    // back so `parse_worker::on_complete`'s `drop(heap::take(result))`
                    // doesn't free the buffer the slot's `Cow::Borrowed` still points at.
                    // (Zig's `=` was a shallow overwrite — no field deinit — so it never
                    // saw this; the Rust swap+drop does.)
                    if matches!(result.source.contents, std::borrow::Cow::Owned(_)) {
                        core::mem::swap(
                            &mut this.graph.input_files.items_source_mut()[result_source_index]
                                .contents,
                            &mut result.source.contents,
                        );
                    }
                    // PORT NOTE: Zig kept `source` as a stable pointer into the SoA.
                    // Borrowck forbids holding `&input_files.source[i]` while writing
                    // other `input_files` columns through the MultiArrayList accessor
                    // methods (each takes `&mut input_files`), so copy out the
                    // `'static` path text now and re-borrow `source` per-use below.
                    let source_path_text: &'static [u8] = this.graph.input_files.items_source()
                        [result_source_index]
                        .path
                        .text;
                    this.source_code_length += if result_source_index != 0 {
                        this.graph.input_files.items_source()[result_source_index]
                            .contents
                            .len()
                    } else {
                        0
                    };

                    this.graph
                        .input_files
                        .items_unique_key_for_additional_file_mut()[result_source_index] =
                        result.unique_key_for_additional_file.slice().into();
                    this.graph
                        .input_files
                        .items_content_hash_for_additional_file_mut()[result_source_index] =
                        result.content_hash_for_additional_file;
                    if !result.unique_key_for_additional_file.is_empty()
                        && result.loader.should_copy_for_bundling()
                    {
                        if let Some(dev) = this.dev_server {
                            let source =
                                &this.graph.input_files.items_source()[result_source_index];
                            dev.put_or_overwrite_asset_erased(
                                &source.path,
                                // SAFETY: when shouldCopyForBundling is true, the
                                // contents are allocated by bun.default_allocator
                                &source.contents,
                                result.content_hash_for_additional_file,
                            )
                            .expect("oom");
                        }
                    }

                    // Record which loader we used for this file
                    this.graph.input_files.items_loader_mut()[result_source_index] = result.loader;

                    bun_core::scoped_log!(
                        Bundle,
                        "onParse({}, {}) = {} imports, {} exports",
                        result_source_index,
                        bstr::BStr::new(source_path_text),
                        result.ast.import_records.len() as usize,
                        result.ast.named_exports.count()
                    );

                    if result.ast.css.is_some() {
                        this.graph.css_file_count += 1;
                    }

                    diff += this.process_resolve_queue(
                        core::mem::take(&mut resolve_queue),
                        result.ast.target,
                        result_source_index as IndexInt,
                    );

                    let mut import_records = core::mem::take(&mut result.ast.import_records);
                    let source_path_owned: Box<[u8]> = source_path_text.into();
                    this.patch_import_record_source_indices(
                        &mut import_records,
                        PatchImportRecordsCtx {
                            source_index: Index::init(result_source_index as IndexInt),
                            source_path: &source_path_owned,
                            loader: result.loader,
                            target: result.ast.target,
                            redirect_import_record_index: result.ast.redirect_import_record_index,
                            force_save: false,
                        },
                    );

                    // Set is_export_star_target for barrel optimization.
                    // In dev server mode, source_index is not saved on JS import
                    // records, so fall back to resolving via the path map.
                    // PORT NOTE: split-borrow `Graph` fields directly so the
                    // `&build_graphs[target]` lookup doesn't lock out
                    // `input_files.items_flags_mut()` (disjoint columns).
                    let result_ast_target = result.ast.target;
                    for star_record_idx in result.ast.export_star_import_records.iter() {
                        if (*star_record_idx as usize) < import_records.len() as usize {
                            let star_ir = &import_records.slice()[*star_record_idx as usize];
                            let resolved_index = if star_ir.source_index.is_valid() {
                                star_ir.source_index.get()
                            } else if let Some(idx) =
                                this.graph.build_graphs[result_ast_target].get_path(&star_ir.path)
                            {
                                idx
                            } else {
                                continue;
                            };
                            this.graph.input_files.items_flags_mut()[resolved_index as usize] |=
                                crate::Graph::InputFileFlags::IS_EXPORT_STAR_TARGET;
                        }
                    }
                    result.ast.import_records = import_records;

                    // PORT NOTE: Zig reads `result.ast.named_exports` /
                    // `result.source` *after* `graph.ast.set(…)` (Zig structs are
                    // value types so the `set` is a shallow copy). The Rust port
                    // moves `result.ast` into `graph.ast` and swapped `result.source`
                    // earlier, so snapshot the data the use-directive block needs
                    // *before* the move. Only paid for files that hit the SCB gate.
                    let named_exports_for_scb = if result.use_directive != crate::UseDirective::None
                        && {
                            let separate = this
                                .framework
                                .as_ref()
                                .unwrap()
                                .server_components
                                .as_ref()
                                .unwrap()
                                .separate_ssr_graph;
                            let is_client = result.use_directive == crate::UseDirective::Client;
                            let is_browser = result_ast_target == Target::Browser;
                            if separate {
                                is_client == is_browser
                            } else {
                                is_client != is_browser
                            }
                        } {
                        Some(result.ast.named_exports.clone().expect("oom"))
                    } else {
                        None
                    };

                    this.graph.ast.set(
                        result_source_index,
                        core::mem::replace(&mut result.ast, JSAst::empty()),
                    );

                    // Barrel optimization: eagerly record import requests and
                    // un-defer barrel records that are now needed.
                    if this.is_barrel_optimization_enabled() {
                        diff += barrel_imports::schedule_barrel_deferred_imports(
                            this,
                            result_source_index as IndexInt,
                            result_ast_target,
                        )
                        .expect("oom");
                    }

                    if let Some(named_exports) = named_exports_for_scb {
                        if result.use_directive == crate::UseDirective::Server {
                            bun_core::todo_panic!("\"use server\"");
                        }

                        let separate_ssr_graph = this
                            .framework
                            .as_ref()
                            .unwrap()
                            .server_components
                            .as_ref()
                            .unwrap()
                            .separate_ssr_graph;

                        // PORT NOTE: `result.source` was swapped into
                        // `graph.input_files` earlier; re-borrow it from the SoA.
                        // `.clone()` materializes the value-copy Zig got for free.
                        let source_loader: Loader =
                            this.graph.input_files.items_loader()[result_source_index];

                        let (reference_source_index, ssr_index) = if separate_ssr_graph {
                            // Enqueue two files, one in server graph, one in ssr graph.
                            let other_source =
                                this.graph.input_files.items_source()[result_source_index].clone();
                            let scb_source =
                                this.graph.input_files.items_source()[result_source_index].clone();
                            let reference_source_index = this
                                .enqueue_server_component_generated_file(
                                    crate::ServerComponentParseTask::Data::ClientReferenceProxy(
                                        crate::ServerComponentParseTask::ReferenceProxy {
                                            other_source,
                                            named_exports,
                                        },
                                    ),
                                    scb_source,
                                )
                                .expect("oom");

                            let mut ssr_source =
                                this.graph.input_files.items_source()[result_source_index].clone();
                            // PORT NOTE: `path_with_pretty_initialized` takes/returns
                            // `Fs::Path` (`bun_resolver::fs::Path`); bridge through
                            // `fs_path_from_logger`/`fs_path_to_logger` until the
                            // three `Path` mirrors unify.
                            ssr_source.path.pretty = ssr_source.path.text;
                            ssr_source.path = path_as_static(
                                this.path_with_pretty_initialized(
                                    ssr_source.path.clone(),
                                    Target::BakeServerComponentsSsr,
                                )
                                .expect("oom"),
                            );
                            let ssr_index = this
                                .enqueue_parse_task2(
                                    &mut ssr_source,
                                    source_loader,
                                    Target::BakeServerComponentsSsr,
                                )
                                .expect("oom");

                            (reference_source_index, ssr_index)
                        } else {
                            // Enqueue only one file
                            let mut server_source =
                                this.graph.input_files.items_source()[result_source_index].clone();
                            server_source.path.pretty = server_source.path.text;
                            let server_target = this.transpiler.options.target;
                            server_source.path = path_as_static(
                                this.path_with_pretty_initialized(
                                    server_source.path.clone(),
                                    server_target,
                                )
                                .expect("oom"),
                            );
                            let server_index = this
                                .enqueue_parse_task2(
                                    &mut server_source,
                                    source_loader,
                                    Target::Browser,
                                )
                                .expect("oom");

                            (server_index, Index::INVALID.get())
                        };

                        this.graph
                            .path_to_source_index_map(result_ast_target)
                            .put(source_path_text, reference_source_index)
                            .expect("oom");

                        this.graph
                            .server_component_boundaries
                            .put(
                                result_source_index as IndexInt,
                                result.use_directive,
                                reference_source_index,
                                ssr_index,
                            )
                            .expect("oom");
                    }
                    let _ = source_path_owned;
                }
                parse_task::ResultValue::Err(err) => {
                    if cfg!(feature = "debug_logs") {
                        bun_core::scoped_log!(Bundle, "onParse() = err");
                    }

                    if process_log {
                        if let Some(dev_server) = this.dev_server {
                            // Copy out the `'static` path slice so the `input_files`
                            // borrow ends before we coerce `this` to `*mut _`.
                            let abs_path: &'static [u8] = this.graph.input_files.items_source()
                                [err.source_index.get() as usize]
                                .path
                                .text;
                            dev_server
                                .handle_parse_task_failure(
                                    err.err,
                                    err.target.bake_graph(),
                                    abs_path,
                                    &raw const err.log,
                                    std::ptr::from_mut(this),
                                )
                                .expect("oom");
                        } else if !err.log.msgs.is_empty() {
                            // SAFETY: `transpiler.log` is a live BACKREF set in BundleV2::init.
                            err.log
                                .clone_to_with_recycled(this.transpiler.log_mut(), true);
                        } else {
                            // PORT NOTE: Zig used `@tagName(err.step)`.
                            let step_name = match err.step {
                                crate::parse_task::Step::Pending => "pending",
                                crate::parse_task::Step::ReadFile => "read_file",
                                crate::parse_task::Step::Parse => "parse",
                                crate::parse_task::Step::Resolve => "resolve",
                            };
                            // SAFETY: `transpiler.log` is a live BACKREF set in BundleV2::init.
                            this.transpiler.log_mut().add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "{} while {}",
                                    bstr::BStr::new(err.err.name()),
                                    step_name
                                ),
                            );
                        }
                    }

                    if cfg!(debug_assertions) && this.dev_server.is_some() {
                        debug_assert!(
                            this.graph.ast.items_parts()[err.source_index.get() as usize].len()
                                == 0
                        );
                    }
                }
            }

            // `defer { graph.pending_items += diff; if diff < 0 on_after_decrement }`
            bun_core::scoped_log!(
                scan_counter,
                "in parse task .pending_items += {} = {}\n",
                diff,
                i32::try_from(this.graph.pending_items).expect("int cast") + diff
            );
            this.graph.pending_items =
                u32::try_from(i32::try_from(this.graph.pending_items).expect("int cast") + diff)
                    .expect("int cast");
            if diff < 0 {
                this.on_after_decrement_scan_counter();
            }
        }

        /// To satisfy the interface from NewHotReloader()
        pub fn get_loaders(&mut self) -> &mut options::LoaderHashTable {
            &mut self.transpiler.options.loaders
        }

        /// To satisfy the interface from NewHotReloader()
        pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
            self.transpiler.resolver.bust_dir_cache(path)
        }
    }

    // `UseDirective`/`ServerComponentBoundary` already imported at module head.

    // DEDUP(D059): WrapKind / ImportData / ExportData / JSMeta / JSMetaFlags /
    // EntryPoint{,Kind,List} / PartRange / StableRef / ImportTracker / DeclInfo* /
    // CompileResult* / ContentHasher / cheap_prefix_normalizer / target_from_hashbang
    // are canonically defined in `crate::ungate_support` (which `lib.rs` already
    // glob-re-exports at the crate root, so every cross-module caller resolves
    // there). The duplicate definitions that previously lived here were provably
    // unreferenced — `bundle_v2.rs` itself uses `crate::ungate_support::PartRange`
    // at the `compute_chunks` body, bypassing its own copy. Re-export the canonical
    // set so any in-module / `bv2_impl::Foo` reference still resolves.
    pub use crate::AdditionalFile;
    pub use crate::ungate_support::entry_point::{
        EntryPoint, Kind as EntryPointKind, List as EntryPointList,
    };
    pub use crate::ungate_support::js_meta::Flags as JSMetaFlags;
    pub use crate::ungate_support::{
        CompileResult, CompileResultForSourceMap, ContentHasher, DeclInfo, DeclInfoKind,
        ExportData, ImportData, ImportTracker, JSMeta, PartRange, ResolvedExports, StableRef,
        TopLevelSymbolToParts, WrapKind, cheap_prefix_normalizer, target_from_hashbang,
    };

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub enum ImportTrackerStatus {
        /// The imported file has no matching export
        #[default]
        NoMatch,

        /// The imported file has a matching export
        Found,

        /// The imported file is CommonJS and has unknown exports
        Cjs,

        /// The import is missing but there is a dynamic fallback object
        DynamicFallback,

        /// The import is missing but there is a dynamic fallback object
        /// and the file was originally CommonJS.
        DynamicFallbackInteropDefault,

        /// The import was treated as a CommonJS import but the file is known to have no exports
        CjsWithoutExports,

        /// The imported file was disabled by mapping it to false in the "browser"
        /// field of package.json
        Disabled,

        /// The imported file is external and has unknown exports
        External,

        /// This is a missing re-export in a TypeScript file, so it's probably a type
        ProbablyTypescriptType,
    }

    /// `bundle_v2.zig:ImportTracker.Iterator`.
    ///
    /// `import_data` is a raw slice into
    /// `graph.meta[i].resolved_exports[..].potentially_ambiguous_export_star_refs`
    /// (Zig returned `Vec.slice()` directly). The graph SoA is never
    /// reallocated during `match_import_with_export`, so the pointer stays valid
    /// for the iterator's lifetime; the caller only reads `.data` from each entry.
    ///
    /// DEDUP NOTE (D060): `value` / `import_data` name the `crate::`-root
    /// (`ungate_support`) flavours of `ImportTracker` / `ImportData` rather than
    /// the local `bv2_impl` duplicates so that `LinkerContext`'s 30+ live call
    /// sites (which import the crate-root types) type-check against this single
    /// canonical definition. The local duplicates collapse in the sibling
    /// `ImportTracker` / `ImportData` dedup clusters.
    pub struct ImportTrackerIterator {
        pub status: ImportTrackerStatus,
        pub value: crate::ImportTracker,
        /// Backref into the link-graph SoA (`graph.meta[..].resolved_exports[..].
        /// potentially_ambiguous_export_star_refs`). `BackRef` (not `*const [T]`)
        /// so the single read site in `match_import_with_export` is a safe `Deref`;
        /// the pointee slab is never reallocated while the iterator is live.
        pub import_data: bun_ptr::BackRef<[crate::ImportData]>,
    }

    impl Default for ImportTrackerIterator {
        fn default() -> Self {
            Self {
                status: ImportTrackerStatus::default(),
                value: crate::ImportTracker::default(),
                import_data: bun_ptr::BackRef::new(&[] as &[crate::ImportData]),
            }
        }
    }

    // `PathTemplate` already in scope via `crate::options`.

    // PORT NOTE: `CrossChunkImport`/`CrossChunkImportItem` are TYPE_ONLY-hoisted in
    // `ungate_support` so `Chunk::ImportsFromOtherChunks` can name them without a
    // cycle. Re-export the canonical definitions here (instead of duplicating) so
    // `sorted_cross_chunk_imports` and `Chunk` agree on the element type.
    pub use crate::ungate_support::{
        CrossChunkImport, CrossChunkImportItem, CrossChunkImportItemList,
    };

    impl CrossChunkImportItem {
        pub fn less_than(_: (), a: &CrossChunkImportItem, b: &CrossChunkImportItem) -> bool {
            strings::order(&a.export_alias, &b.export_alias) == core::cmp::Ordering::Less
        }
    }

    impl CrossChunkImport {
        pub fn less_than(_: (), a: &CrossChunkImport, b: &CrossChunkImport) -> bool {
            a.chunk_index < b.chunk_index
        }

        pub fn sorted_cross_chunk_imports(
            list: &mut Vec<CrossChunkImport>,
            chunks: &mut [Chunk],
            imports_from_other_chunks: &mut chunk::ImportsFromOtherChunks,
        ) -> Result<(), Error> {
            // PORT NOTE: reshaped for borrowck — Zig used `defer list.* = result;`.
            list.clear();
            list.reserve(imports_from_other_chunks.count());

            for i in 0..imports_from_other_chunks.count() {
                let chunk_index = imports_from_other_chunks.keys()[i];
                let chunk = &mut chunks[chunk_index as usize];

                // Sort imports from a single chunk by alias for determinism
                let exports_to_other_chunks = &chunk.content.javascript().exports_to_other_chunks;
                let import_items = &mut imports_from_other_chunks.values_mut()[i];
                for item in import_items.slice_mut() {
                    item.export_alias = (*exports_to_other_chunks.get(&item.r#ref).unwrap()).into();
                    debug_assert!(!item.export_alias.is_empty());
                }
                import_items
                    .slice_mut()
                    .sort_by(|a, b| strings::order(&a.export_alias, &b.export_alias));

                // Zig value-copies the Vec header so both `result[_]` and the
                // map slot share the backing buffer; `rename_symbols_in_chunk`
                // re-reads `imports_from_other_chunks.values()` afterwards. Taking
                // would leave the map slot empty and break that consumer.
                list.push(CrossChunkImport {
                    chunk_index,
                    sorted_import_items: import_items.shallow_copy(),
                });
            }

            list.sort_by(|a, b| a.chunk_index.cmp(&b.chunk_index));
            Ok(())
        }
    }

    fn get_redirect_id(id: u32) -> Option<u32> {
        if id == u32::MAX {
            return None;
        }
        Some(id)
    }

    #[derive(Clone, Copy, Default)]
    pub struct CssEntryPointMeta {
        /// When this is true, a stub file is added to the Server's IncrementalGraph
        pub imported_on_server: bool,
    }

    /// The lifetime of this structure is tied to the bundler's arena
    pub struct DevServerInput {
        pub css_entry_points: ArrayHashMap<Index, CssEntryPointMeta>,
    }

    /// The lifetime of this structure is tied to the bundler's arena
    pub struct DevServerOutput<'a> {
        pub chunks: &'a mut [Chunk],
        pub css_file_list: ArrayHashMap<Index, CssEntryPointMeta>,
        pub html_files: ArrayHashMap<Index, ()>,
    }

    impl<'a> DevServerOutput<'a> {
        pub fn js_pseudo_chunk(&mut self) -> &mut Chunk {
            &mut self.chunks[0]
        }

        pub fn css_chunks(&mut self) -> &mut [Chunk] {
            &mut self.chunks[1..][..self.css_file_list.count()]
        }

        pub fn html_chunks(&mut self) -> &mut [Chunk] {
            &mut self.chunks[1 + self.css_file_list.count()..][..self.html_files.count()]
        }
    }

    pub fn generate_unique_key() -> u64 {
        let key = bun_core::fast_random() & 0x0FFFFFFF_FFFFFFFF_u64;
        // without this check, putting unique_key in an object key would
        // sometimes get converted to an identifier. ensuring it starts
        // with a number forces that optimization off.
        if cfg!(debug_assertions) {
            let mut buf = [0u8; 16];
            let written = {
                let mut cursor = &mut buf[..];
                write!(cursor, "{:016x}", key).expect("unreachable");
                16 - cursor.len()
            };
            let hex = &buf[..written];
            match hex[0] {
                b'0'..=b'9' => {}
                _ => Output::panic(format_args!(
                    "unique key is a valid identifier: {}",
                    bstr::BStr::new(hex)
                )),
            }
        }
        key
    }

    struct ExternalFreeFunctionAllocator {
        free_callback: unsafe extern "C" fn(*mut c_void),
        context: *mut c_void,
    }

    impl ExternalFreeFunctionAllocator {
        // TODO(port): std.mem.Allocator vtable equivalent — Phase B will define bun_alloc::Allocator trait impl

        pub fn create(
            free_callback: unsafe extern "C" fn(*mut c_void),
            context: *mut c_void,
        ) -> bun_alloc::StdAllocator {
            // PORT NOTE: Zig built a `std.mem.Allocator` whose `.ptr` was the boxed
            // `ExternalFreeFunctionAllocator` and whose vtable's `free` invoked the
            // plugin callback. `bun_alloc::StdAllocator` is the Rust equivalent.
            let boxed = bun_core::heap::into_raw(Box::new(ExternalFreeFunctionAllocator {
                free_callback,
                context,
            }));
            bun_alloc::StdAllocator {
                ptr: boxed.cast(),
                vtable: &EXTERNAL_FREE_VTABLE,
            }
        }

        fn alloc(_: *mut c_void, _: usize, _: bun_alloc::Alignment, _: usize) -> Option<*mut u8> {
            None
        }

        fn free(ext_free_function: *mut c_void, _: &mut [u8], _: bun_alloc::Alignment, _: usize) {
            // SAFETY: ptr was created by ExternalFreeFunctionAllocator::create
            let info: &mut ExternalFreeFunctionAllocator =
                unsafe { &mut *ext_free_function.cast::<ExternalFreeFunctionAllocator>() };
            // SAFETY: free_callback is a valid C fn provided by plugin
            unsafe { (info.free_callback)(info.context) };
            // SAFETY: info was heap-allocated in create()
            drop(unsafe { bun_core::heap::take(info) });
        }
    }

    /// `pub` so `bun_runtime::allocators::register_safety_vtables` can push the
    /// address into the `bun_safety` registry (Zig spec: `bun.bundle_v2.
    /// allocatorHasPointer` is one of the `safety/alloc.zig:hasPtr` arms).
    pub static EXTERNAL_FREE_VTABLE: bun_alloc::AllocatorVTable = bun_alloc::AllocatorVTable {
        alloc: |_, _, _, _| core::ptr::null_mut(),
        resize: |_, _, _, _, _| false,
        remap: |_, _, _, _, _| core::ptr::null_mut(),
        free: |ctx, buf, a, ra| ExternalFreeFunctionAllocator::free(ctx, buf, a, ra),
    };

    /// Returns true if `arena` definitely has a valid `.ptr`.
    /// May return false even if `.ptr` is valid.
    ///
    /// This function should check whether `arena` matches any internal arena types known to
    /// have valid pointers. Allocators defined outside of this file, like `std.heap.ArenaAllocator`,
    /// don't need to be checked.
    pub fn allocator_has_pointer(arena: &bun_alloc::StdAllocator) -> bool {
        // bundle_v2.zig:4443 — vtable identity check.
        core::ptr::eq(arena.vtable, &raw const EXTERNAL_FREE_VTABLE)
    }

    // LAYERING: `BuildResult` / `BundleV2Result` are defined once in
    // `BundleThread.rs` (the trait that consumes them lives there). The previous
    // duplicate here meant `CompletionStruct::set_result` and `BundleV2::
    // run_from_js_in_new_thread` named two distinct types with identical fields.
    // Re-export the canonical defs so `bundle_v2::` and `BundleThread::` paths
    // resolve to the same nominal type.
    pub use crate::BundleThread::{BuildResult, BundleV2Result, CompletionStruct, singleton};

    // re-exports
    pub use crate::HTMLScanner::HTMLScanner;
    pub use crate::IndexStringMap::IndexStringMap;
    pub type BitSet = DynamicBitSetUnmanaged;
    pub use bun_ast::Loc;

    // C++ binding for lazy metafile getter (defined in BundlerMetafile.cpp)
    // Uses jsc.conv (SYSV_ABI on Windows x64) for proper calling convention
    // Sets up metafile object with { json: <lazy parsed>, markdown?: string }

    // ported from: src/bundler/bundle_v2.zig
}
