//! Instance of the development server. Attaches to an instance of `Bun.serve`,
//! controlling bundler, routing, and hot module reloading. All work is held
//! in-memory, with hardcore data-oriented-design.
//!
//! Reprocessing files that did not change is banned; by having perfect
//! incremental tracking over the project, editing a file's contents (asides
//! adjusting imports) must always rebundle only that one file.
//!
//! Theorized and designed over 2 years out of pure love —— paper clover <3
//! For questions about its core philosophy, email `devserver@paperclover.net`

use ::core::cell::Cell;

use bun_bundler::mal_prelude::*;
use bun_ptr::JsCell;
use std::io::Write as _;
use std::time::Instant;

use bun_alloc::{AllocError, Arena};
use bun_ast::Log;
use bun_bundler::options_impl::TargetExt as _;
use bun_collections::{ArrayHashMap, DynamicBitSet, HashMap, StringHashMap};
use bun_core::{self as str, String as BunString, ZStr, strings};
use bun_core::{Environment, Output};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::{LogJsc as _, StringJsc as _};
use bun_paths::{self as paths, PathBuffer};
use bun_sys as sys;
use bun_uws::{AnyResponse, Opcode, Request, WebSocketUpgradeContext};
use bun_watcher::WatchItemColumns as _;
use bun_wyhash::{Wyhash, hash};

use crate::api::server::StaticRoute;
use crate::api::{AnyServer, SavedRequest};
use crate::bake;
use crate::bake::framework_router::{self as framework_router, FrameworkRouter, OpaqueFileId};
use crate::server::html_bundle::HTMLBundleRoute;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use crate::webcore::{Request as WebRequest, Response};
use bun_ast::Loader;
use bun_bundler::{self as bundler, BundleV2, Transpiler};
use bun_http::{Method, MimeType};
use bun_safety::ThreadLock;
use bun_watcher::Watcher;

pub(super) use crate::bake::dev_server::DirectoryWatchStore;
pub(super) use crate::bake::dev_server::HmrSocket;
use crate::bake::dev_server::ResponseLike;
pub(super) use crate::bake::dev_server::assets::Assets;
pub(super) use crate::bake::dev_server::error_report_request::ErrorReportRequest;

pub(super) use crate::bake::dev_server::incremental_graph::IncrementalGraph;
pub(super) use crate::bake::dev_server::memory_cost::MemoryCost;

impl DevServer {
    /// `DevServer.memoryCost` — sums the per-category breakdown from
    /// `memory_cost_detailed`. Body lives in `dev_server::memory_cost`.
    #[inline]
    pub(crate) fn memory_cost(&self) -> usize {
        crate::bake::dev_server::memory_cost::memory_cost(self)
    }

    /// `DevServer.memoryCostDetailed` — body lives in
    /// `dev_server::memory_cost`.
    #[inline]
    pub(crate) fn memory_cost_detailed(&self) -> MemoryCost {
        crate::bake::dev_server::memory_cost::memory_cost_detailed(self)
    }

    /// Recover `&VirtualMachine` from the JSC_BORROW `vm` back-reference.
    /// Safe `Deref` via [`BackRef`](bun_ptr::BackRef): vm is valid for
    /// DevServer's entire lifetime.
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    /// Safe `&'static JSGlobalObject` accessor — `self.vm().global()`.
    /// `'static` so the borrow is decoupled from `&self` and may be held
    /// across `&mut self` reborrows.
    #[inline]
    fn global(&self) -> &'static JSGlobalObject {
        self.vm().global()
    }

    /// Recover `&mut VirtualMachine` via the global singleton — `self.vm` is
    /// `*const`. The VM is process-unique on the JS thread, so
    /// `VirtualMachine::get()` returns the same instance with write provenance.
    #[inline]
    pub(crate) fn vm_mut(&self) -> &mut VirtualMachine {
        debug_assert!(::core::ptr::eq(
            self.vm.as_const_ptr(),
            VirtualMachine::get()
        ));
        VirtualMachine::get_mut()
    }

    /// The heap cell this dev server lives in (see [`DevServerCell`]).
    #[inline]
    pub(crate) fn this(&self) -> bun_ptr::ThisPtr<DevServerCell> {
        self.this.expect("set by init()").this_ptr()
    }

    #[inline]
    pub(crate) fn server_transpiler(&self) -> &Transpiler<'static> {
        &self.server_transpiler
    }

    #[inline]
    pub(crate) fn watcher(&mut self) -> &mut Watcher {
        self.bun_watcher.as_deref_mut().expect("watcher is live")
    }

    /// Split borrow for `DirectoryWatchStore` methods that evict watch entries.
    #[inline]
    pub(crate) fn directory_watchers_and_watcher(
        &mut self,
    ) -> (&mut DirectoryWatchStore, &mut Watcher) {
        (
            &mut self.directory_watchers,
            self.bun_watcher.as_deref_mut().expect("watcher is live"),
        )
    }

    /// `client_graph` together with the sibling state its methods reach.
    #[inline]
    pub(crate) fn client_graph_mut(
        &mut self,
    ) -> incremental_graph::GraphRef<'_, { bake::Side::Client }> {
        incremental_graph::GraphRef {
            g: &mut self.client_graph,
            s: incremental_graph::GraphSiblings {
                client_graph: None,
                server_graph: Some(&mut self.server_graph),
                incremental_result: &mut self.incremental_result,
                bundling_failures: &mut self.bundling_failures,
                assets: &mut self.assets,
                directory_watchers: &mut self.directory_watchers,
                bun_watcher: self.bun_watcher.as_deref_mut().expect("watcher is live"),
                route_lookup: &self.route_lookup,
                root: &self.root,
                configuration_hash_key: &self.configuration_hash_key,
                graph_safety_lock: &self.graph_safety_lock,
            },
        }
    }

    /// `server_graph` together with the sibling state its methods reach.
    #[inline]
    pub(crate) fn server_graph_mut(
        &mut self,
    ) -> incremental_graph::GraphRef<'_, { bake::Side::Server }> {
        incremental_graph::GraphRef {
            g: &mut self.server_graph,
            s: incremental_graph::GraphSiblings {
                client_graph: Some(&mut self.client_graph),
                server_graph: None,
                incremental_result: &mut self.incremental_result,
                bundling_failures: &mut self.bundling_failures,
                assets: &mut self.assets,
                directory_watchers: &mut self.directory_watchers,
                bun_watcher: self.bun_watcher.as_deref_mut().expect("watcher is live"),
                route_lookup: &self.route_lookup,
                root: &self.root,
                configuration_hash_key: &self.configuration_hash_key,
                graph_safety_lock: &self.graph_safety_lock,
            },
        }
    }
}
pub(super) use crate::bake::dev_server::HotReloadShared;
pub(super) use crate::bake::dev_server::route_bundle::RouteBundle;
pub(super) use crate::bake::dev_server::serialized_failure::SerializedFailure;
pub(super) use crate::bake::dev_server::source_map_store::SourceMapStore;

bun_output::declare_scope!(DevServer, visible);
bun_output::declare_scope!(SourceMapStore, visible);

bun_output::define_scoped_log!(debug_log, crate::bake::dev_server_body::DevServer);
bun_output::define_scoped_log!(map_log, crate::bake::dev_server_body::SourceMapStore);
pub(crate) use map_log;

pub struct Options<'a> {
    /// Arena must live until DevServer drops
    pub arena: &'a Arena,
    pub root: &'a ZStr,
    pub vm: &'a VirtualMachine,
    /// The `Bun.serve` instance that owns the dev server.
    pub server: AnyServer,
    pub framework: bake::Framework,
    pub bundler_options: bake::SplitBundlerOptions,
    pub broadcast_console_log_from_browser_to_server: bool,
}

// Note: the fields (`arena`, `root`, `vm`, `server`, `framework`,
// `bundler_options`, `broadcast_console_log_from_browser_to_server`) are
// required with no sensible zero value, so `Default` is intentionally NOT
// implemented. Callers construct `Options` via struct-literal at the call site
// (see `bake_body.rs::UserOptions::into_dev_server_options`).

#[cfg(debug_assertions)]
#[repr(u128)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Magic {
    Valid = 0x1ffd363f121f5c12,
}
#[cfg(not(debug_assertions))]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Magic {
    Valid,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PluginState {
    /// Should ask server for plugins. Once plugins are loaded, the plugin
    /// pointer is written into `server_transpiler.options.plugin`
    Unknown,
    // These two states mean that `server.getOrLoadPlugins()` was called.
    Pending,
    Loaded,
    /// Currently, this represents a degraded state where no bundle can
    /// be correctly executed because the plugins did not load successfully.
    Err,
}

pub enum TestingBatchEvents {
    Disabled,
    /// A meta-state where the DevServer has been requested to start a batch,
    /// but is currently bundling something so it must wait. In this state, the
    /// harness is waiting for a "i am in batch mode" message, and it waits
    /// until the bundle finishes.
    EnableAfterBundle,
    /// DevServer will not start new bundles, but instead write all files into
    /// this `TestingBatch` object. Additionally, writes into this will signal
    /// a message saying that new files have been seen. Once DevServer receives
    /// that signal, or times out, it will "release" this batch.
    Enabled(TestingBatch),
}

/// There is only ever one bundle executing at the same time, since all bundles
/// inevitably share state. This bundle is asynchronous, storing its state here
/// while in-flight. All allocations held by `.bv2.graph.heap`'s arena
pub struct CurrentBundle {
    /// OWNED (LIFETIMES.tsv): `BundleV2.init()` → `deinitWithoutFreeingArena()`.
    /// Note: `'static` is a stand-in for the DevServer-self lifetime —
    /// `BundleV2<'a>` borrows the three `Transpiler<'_>` fields stored inline
    /// in `DevServer`, so the true bound is the `Box<DevServer>` allocation
    /// (stable address, never moved post-init). Threading a real `'dev` would
    /// make `DevServer` self-referential; raw-ptr aliasing inside `BundleV2`
    /// already encodes that contract.
    pub bv2: Box<BundleV2<'static>>,
    /// Owns the arena that `bv2.graph.heap` borrows (`'static` self-ref via the
    /// boxed allocation's stable address; same erasure as `bv2` above).
    pub heap: Box<bun_alloc::MimallocArena>,
    /// Backs the small `AstVec`s built during bundle setup
    /// (`start_async_bundle`'s AST scope); dropped with the bundle.
    pub ast_alloc_state: Option<Box<bun_alloc::ast_alloc::AstAllocState>>,
    /// Information BundleV2 needs to finalize the bundle
    pub(crate) start_data: bundler::bundle_v2::DevServerInput,
    /// Started when the bundle was queued
    pub(crate) timer: Instant,
    /// If any files in this bundle were due to hot-reloading, some extra work
    /// must be done to inform clients to reload routes. When this is false,
    /// all entry points do not have bundles yet.
    pub(crate) had_reload_event: bool,
    /// After a bundle finishes, these requests will be continued, either
    /// calling their handler on success or sending the error page on failure.
    pub(crate) requests: deferred_request::List,
    /// Resolution failures are grouped by incremental graph file index.
    /// Unlike parse failures (`handleParseTaskFailure`), the resolution
    /// failures can be created asynchronously, and out of order.
    pub(crate) resolution_failure_entries: ArrayHashMap<serialized_failure::OwnerPacked, Log>,

    /// 1. Always make sure to deinit this promise
    /// 2. Always drain microtasks after resolving it
    pub(crate) promise: DeferredPromise,
}

/// A request to `DevServer::start_async_bundle`.
pub(crate) struct BundleRequest {
    pub(crate) entry_points: EntryPointList,
    pub(crate) had_reload_event: bool,
    /// When the work that led to this bundle started.
    pub(crate) timer: Instant,
}

/// A bundle set up by `start_async_bundle_setup`, before its entry points are
/// enqueued.
struct BundleSetup {
    bv2: Box<BundleV2<'static>>,
    /// Lives in `heap`; AST nodes built while the entry points are enqueued go
    /// through it (see `start_async_bundle`).
    ast_memory_store: &'static mut bun_ast::ASTMemoryAllocator,
    heap: Box<bun_alloc::MimallocArena>,
}

pub struct NextBundle {
    /// A list of `RouteBundle`s which have active requests to bundle it.
    pub(crate) route_queue: ArrayHashMap<route_bundle::Index, ()>,
    /// If a reload event exists and should be drained: the index of its slot
    /// in `dev.hot_reload.events`.
    pub(crate) reload_event: Option<u8>,
    /// The list of requests that are blocked on this bundle.
    pub(crate) requests: deferred_request::List,

    pub(crate) promise: DeferredPromise,
}

/// The heap cell a [`DevServer`] lives in. `Bun.serve`'s `NewServer` owns it
/// (`OwnedThis<DevServerCell>`); the uws routes, HMR sockets, deferred
/// requests, the bundler's `DevServerHandle` and queued hot-reload tasks hold
/// `ThisPtr`/`BackRef`s to it and enter through [`with_mut`](Self::with_mut).
/// All of them are torn down by (or before) `Drop for DevServer`.
pub struct DevServerCell(JsCell<DevServer>);

impl DevServerCell {
    /// JS-thread only; see [`JsCell::with_mut`].
    #[inline]
    pub fn with_mut<R>(&self, f: impl FnOnce(&mut DevServer) -> R) -> R {
        self.0.with_mut(f)
    }

    #[inline]
    pub fn get(&self) -> &DevServer {
        self.0.get()
    }
}

// Note: this is the **canonical** `DevServer` struct. `dev_server/mod.rs`
// re-exports it (`pub use super::dev_server_body::DevServer`) so the
// submodules (`incremental_graph`, `assets`, …) and the method bodies in this
// file all name the same type. The `Transpiler<'static>` / `BundleV2<'static>`
// borrow `bun_alloc::default_arena()`.
pub struct DevServer {
    /// To validate the DevServer has not been collected, this can be checked.
    pub(crate) magic: Magic,
    /// Back-reference to the cell this lives in; set by `init()` right after
    /// allocation.
    pub(crate) this: Option<bun_ptr::BackRef<DevServerCell, bun_ptr::Root>>,
    /// Absolute path to project root directory. For the HMR
    /// runtime, its module IDs are strings relative to this.
    pub(crate) root: Box<[u8]>,
    /// Unique identifier for this DevServer instance. Used to identify it
    /// when using the debugger protocol.
    pub(crate) inspector_server_id: DebuggerId,
    /// Hex string generated by hashing the framework config and bun revision.
    /// Emebedding in client bundles and sent when the HMR Socket is opened;
    /// When the value mismatches the page is forcibly reloaded.
    pub(crate) configuration_hash_key: [u8; 16],
    /// The virtual machine (global object) to execute code in.
    /// [`BackRef`](bun_ptr::BackRef): the VM outlives the `Bun.serve` instance
    /// that owns this dev server.
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>,
    /// The `Bun.serve` instance that owns this dev server.
    pub(crate) server: AnyServer,
    /// Contains the tree of routes. This structure contains FileIndex
    pub(crate) router: FrameworkRouter,
    /// Every navigatable route has bundling state here.
    pub(crate) route_bundles: Vec<RouteBundle>,
    /// All access into IncrementalGraph is guarded by a ThreadLock. This is
    /// only a debug assertion as contention to this is always a bug; If a bundle is
    /// active and a file is changed, that change is placed into the next bundle.
    pub(crate) graph_safety_lock: ThreadLock,
    pub(crate) client_graph: IncrementalGraph<{ bake::Side::Client }>,
    pub(crate) server_graph: IncrementalGraph<{ bake::Side::Server }>,
    /// Barrel files with deferred (is_unused) import records. These files must
    /// be re-parsed on every incremental build because the set of needed exports
    /// may have changed. Populated by applyBarrelOptimization.
    pub(crate) barrel_files_with_deferrals: bun_collections::StringArrayHashMap<()>,
    /// Accumulated barrel export requests across all builds. Maps barrel file
    /// path → set of export names that have been requested. This ensures that
    /// when a barrel is re-parsed in an incremental build, exports requested
    /// by non-stale files (from previous builds) are still kept.
    pub(crate) barrel_needed_exports: bun_collections::StringArrayHashMap<StringHashMap<()>>,
    /// State populated during bundling and hot updates. Often cleared
    pub(crate) incremental_result: IncrementalResult,
    /// Quickly retrieve a framework route's index from its entry point file. These
    /// are populated as the routes are discovered. The route may not be bundled OR
    /// navigatable, such as the case where a layout's index is looked up.
    pub(crate) route_lookup:
        ArrayHashMap<incremental_graph::ServerFileIndex, RouteIndexAndRecurseFlag>,
    /// This acts as a duplicate of the lookup table in uws, but only for HTML routes
    /// Used to identify what route a connected WebSocket is on, so that only
    /// the active pages are notified of a hot updates.
    pub(crate) html_router: HTMLRouter,
    /// Assets are accessible via `/_bun/asset/<key>`
    /// This store is not thread safe.
    pub(crate) assets: Assets,
    /// Similar to `assets`, specialized for the additional needs of source mappings.
    pub(crate) source_maps: SourceMapStore,
    /// All bundling failures are stored until a file is saved and rebuilt.
    /// They are stored in the wire format the HMR runtime expects so that
    /// serialization only happens once.
    /// Keyed by `failure.owner`, stored as `OwnerPacked → SerializedFailure`.
    pub(crate) bundling_failures: ArrayHashMap<serialized_failure::OwnerPacked, SerializedFailure>,
    /// When set, nothing is ever bundled for the server-side,
    /// and DevSever acts purely as a frontend bundler.
    pub(crate) frontend_only: bool,
    /// The Plugin API is missing a way to attach filesystem watchers (addWatchFile)
    /// This special case makes `bun-plugin-tailwind` work, which is a requirement
    /// to ship initial incremental bundling support for HTML files.
    pub(crate) has_tailwind_plugin_hack: Option<ArrayHashMap<Box<[u8]>, ()>>,

    // These values are handles to the functions in `hmr-runtime-server.ts`.
    // For type definitions, see `./bake.private.d.ts`
    pub(crate) server_fetch_function_callback: jsc::StrongOptional,
    pub(crate) server_register_update_callback: jsc::StrongOptional,

    // Watching
    /// `Some` until `Drop`, which hands the watcher to `shutdown_boxed` (the
    /// watcher thread may still be using the allocation, so it frees it).
    pub(crate) bun_watcher: Option<Box<Watcher>>,
    pub(crate) directory_watchers: DirectoryWatchStore,
    /// The hot-reload event triple-buffer shared with the watcher thread.
    pub(crate) hot_reload: std::sync::Arc<HotReloadShared>,
    pub(crate) testing_batch_events: TestingBatchEvents,

    /// Number of bundles that have been executed. This is currently not read, but
    /// will be used later to determine when to invoke graph garbage collection.
    pub(crate) generation: usize,
    /// Displayed in the HMR success indicator
    pub(crate) bundles_since_last_error: usize,

    pub(crate) framework: bake::Framework,
    pub(crate) bundler_options: bake::SplitBundlerOptions,
    // Each logical graph gets its own bundler configuration. Boxed because the
    // transpiler's linker holds pointers into it.
    pub(crate) server_transpiler: Box<Transpiler<'static>>,
    pub(crate) client_transpiler: Box<Transpiler<'static>>,
    /// `None` unless the framework asked for a separate SSR graph (then the
    /// server transpiler doubles as the SSR one).
    pub(crate) ssr_transpiler: Option<Box<Transpiler<'static>>>,
    /// The log used by all `server_transpiler`, `client_transpiler` and `ssr_transpiler`.
    /// Note that it is rarely correct to write messages into it. Instead, associate
    /// messages with the IncrementalGraph file or Route using `SerializedFailure`.
    /// Boxed because the transpilers hold its address.
    pub(crate) log: Box<Log>,
    pub(crate) plugin_state: PluginState,
    /// See `CurrentBundle` doc comment.
    pub(crate) current_bundle: Option<CurrentBundle>,
    /// When `current_bundle` is non-null and new requests to bundle come in,
    /// those are temporaried here. When the current bundle is finished, it
    /// will immediately enqueue this.
    pub(crate) next_bundle: NextBundle,
    /// UWS can handle closing the websocket connections themselves. Keyed by
    /// the socket's address.
    pub(crate) active_websocket_connections: HashMap<usize, bun_ptr::RefPtr<HmrSocket>>,

    // Debugging
    /// Reference count to number of active sockets with the incremental_visualizer enabled.
    pub(crate) emit_incremental_visualizer_events: u32,
    /// Reference count to number of active sockets with the memory_visualizer enabled.
    pub(crate) emit_memory_visualizer_events: u32,
    pub(crate) memory_visualizer_timer: EventLoopTimer,

    pub(crate) assume_perfect_incremental_bundling: bool,

    /// If true, console logs from the browser will be echoed to the server console.
    pub(crate) broadcast_console_log_from_browser_to_server: bool,
}

bun_event_loop::impl_timer_owner!(DevServer; from_timer_ptr => memory_visualizer_timer);

const INTERNAL_PREFIX: &str = "/_bun";
/// Assets which are routed to the `Assets` storage.
const ASSET_PREFIX: &str = const_format::concatcp!(INTERNAL_PREFIX, "/asset");
/// Client scripts are available at `/_bun/client/{name}-{rbi}{generation}.js`
/// where:
/// - `name` is the display name of the route, such as "index" or
///          "about". It is ignored when routing.
/// - `rbi` is the route bundle index, in padded hex (e.g. `00000001`)
/// - `generation` which is initialized to a random value. This value is
///                re-randomized whenever `client_bundle` is invalidated.
///
/// Example: `/_bun/client/index-00000000f209a20e.js`
const CLIENT_PREFIX: &str = const_format::concatcp!(INTERNAL_PREFIX, "/client");

#[derive(Default)]
pub struct DeferredPromise {
    pub(crate) strong: jsc::JSPromiseStrong,
    pub(crate) route_bundle_indices: ArrayHashMap<route_bundle::Index, ()>,
}

impl DeferredPromise {
    pub fn reset(&mut self) {
        self.strong = jsc::JSPromiseStrong::empty();
        self.route_bundle_indices.clear_retaining_capacity();
    }

    pub(crate) fn deinit_idempotently(&mut self) {
        self.strong = jsc::JSPromiseStrong::empty();
        self.route_bundle_indices = Default::default();
    }
}

/// DevServer is stored on the heap, in a [`DevServerCell`].
pub(crate) fn init(options: Options) -> JsResult<bun_ptr::OwnedThis<DevServerCell>> {
    bun_core::analytics::Features::DEV_SERVER.fetch_add(1, ::core::sync::atomic::Ordering::Relaxed);

    let separate_ssr_graph = options
        .framework
        .server_components
        .as_ref()
        .map(|sc| sc.separate_ssr_graph)
        .unwrap_or(false);

    let global = options.vm.global();

    let generic_action = "while initializing development server";
    let root = paths::string_paths::without_trailing_slash_windows_path(options.root.as_bytes());
    // FileSystem is a process-lifetime singleton; `init` interns the path into
    // the `DirnameStore` (process-lifetime arena) so no caller-side leak is
    // needed for the `'static` it stores.
    let _fs = match bun_resolver::fs::FileSystem::init(Some(root)) {
        Ok(fs) => fs,
        Err(err) => return Err(global.throw_error(err, generic_action)),
    };
    let top_level_dir: &'static [u8] = bun_resolver::fs::FileSystem::get().top_level_dir;

    // The transpilers outlive `options.arena` (they are `'static`), so their
    // long-lived allocations (define tables) come from the process arena.
    let arena = bun_alloc::default_arena();
    let mut framework = options.framework;
    let bundler_options = options.bundler_options;
    let mut log = Box::new(Log::init());

    let server_transpiler = framework
        .init_transpiler(
            arena,
            &mut log,
            bake::Mode::Development,
            bake::Graph::Server,
            &bundler_options.server,
        )
        .map_err(|err| global.throw_error(err, generic_action))?;
    let client_transpiler = framework
        .init_transpiler(
            arena,
            &mut log,
            bake::Mode::Development,
            bake::Graph::Client,
            &bundler_options.client,
        )
        .map_err(|err| global.throw_error(err, generic_action))?;
    let ssr_transpiler = if separate_ssr_graph {
        Some(
            framework
                .init_transpiler(
                    arena,
                    &mut log,
                    bake::Mode::Development,
                    bake::Graph::Ssr,
                    &bundler_options.ssr,
                )
                .map_err(|err| global.throw_error(err, generic_action))?,
        )
    } else {
        None
    };

    let hot_reload = HotReloadShared::new(None, options.vm.handle());
    let bun_watcher = Watcher::init_with_handler(
        Box::new(crate::bake::dev_server::DevWatcherHandler {
            shared: std::sync::Arc::clone(&hot_reload),
        }),
        top_level_dir,
    )
    .map_err(|err| {
        global.throw_error(
            err,
            "while initializing file watcher for development server",
        )
    })?;

    let owned = bun_ptr::OwnedThis::new(DevServerCell(JsCell::new(DevServer {
        magic: Magic::Valid,
        this: None,
        root: Box::from(root),
        vm: bun_ptr::BackRef::new(options.vm),
        server: options.server,
        directory_watchers: DirectoryWatchStore::default(),
        server_fetch_function_callback: jsc::StrongOptional::empty(),
        server_register_update_callback: jsc::StrongOptional::empty(),
        generation: 0,
        graph_safety_lock: ThreadLock::init_unlocked(),
        frontend_only: framework.file_system_router_types.is_empty(),
        framework,
        bundler_options,
        emit_incremental_visualizer_events: 0,
        emit_memory_visualizer_events: 0,
        memory_visualizer_timer: EventLoopTimer::init_paused(
            EventLoopTimerTag::DevServerMemoryVisualizerTick,
        ),
        client_graph: IncrementalGraph::default(),
        server_graph: IncrementalGraph::default(),
        barrel_files_with_deferrals: Default::default(),
        barrel_needed_exports: Default::default(),
        incremental_result: IncrementalResult::EMPTY,
        route_lookup: Default::default(),
        route_bundles: Vec::new(),
        html_router: HTMLRouter::empty(),
        active_websocket_connections: Default::default(),
        current_bundle: None,
        next_bundle: NextBundle {
            route_queue: Default::default(),
            reload_event: None,
            requests: deferred_request::List::default(),
            promise: DeferredPromise::default(),
        },
        inspector_server_id: DebuggerId::init(0),
        assets: Assets {
            path_map: Default::default(),
            files: Default::default(),
            refs: Default::default(),
            needs_reindex: false,
        },
        source_maps: SourceMapStore::empty(),
        plugin_state: PluginState::Unknown,
        bundling_failures: Default::default(),
        assume_perfect_incremental_bundling:
            bun_core::env_var::feature_flag::BUN_ASSUME_PERFECT_INCREMENTAL
                .get()
                .unwrap_or(bun_core::env::IS_DEBUG),
        testing_batch_events: TestingBatchEvents::Disabled,
        broadcast_console_log_from_browser_to_server: options
            .broadcast_console_log_from_browser_to_server,
        bundles_since_last_error: 0,
        has_tailwind_plugin_hack: None,
        configuration_hash_key: [0; 16],
        log,
        server_transpiler,
        client_transpiler,
        ssr_transpiler,
        bun_watcher: Some(bun_watcher),
        hot_reload,
        // Placeholder until the real router is built below (after the
        // transpilers + `framework.resolve`).
        router: FrameworkRouter {
            root: Box::from(root),
            types: Box::new([]),
            routes: Vec::new(),
            static_routes: Default::default(),
            dynamic_routes: Default::default(),
            pattern_string_arena: Arena::new(),
        },
    })));
    let this_ref: bun_ptr::BackRef<DevServerCell, bun_ptr::Root> = owned.this_ptr().into();
    let scratch_arena = options.arena;

    owned.with_mut(|dev| -> JsResult<()> {
        dev.this = Some(this_ref);
        dev.hot_reload.main.lock().dev = Some(bun_ptr::ThreadBound::new(this_ref.get()));

        let _unlock = dev.graph_safety_lock.guard();

        if let Err(err) = dev.watcher().start() {
            return Err(global.throw_error(
                err,
                "while initializing file watcher thread for development server",
            ));
        }

        // `bun_resolver::AnyResolveWatcher` is now a re-export of
        // `bun_watcher::AnyResolveWatcher` (LAYERING: same type), so the watcher's
        // vtable flows directly into the resolver without conversion.
        let resolve_watcher = dev.watcher().get_resolve_watcher();
        // The bundler only null-checks `options.dev_server`; the dispatch
        // handle proper is handed to each `BundleV2` in `start_async_bundle`.
        let handle_marker = dev.bundler_handle().owner.cast_const();
        dev.server_transpiler.options.dev_server = handle_marker;
        dev.server_transpiler.resolver.watcher = Some(resolve_watcher);
        dev.client_transpiler.options.dev_server = handle_marker;
        dev.client_transpiler.resolver.watcher = Some(resolve_watcher);
        if let Some(ssr) = &mut dev.ssr_transpiler {
            ssr.options.dev_server = handle_marker;
            ssr.resolver.watcher = Some(resolve_watcher);
        }

        debug_assert!(dev.server_transpiler.resolver.opts.target != bun_ast::Target::Browser);
        debug_assert!(dev.client_transpiler.resolver.opts.target == bun_ast::Target::Browser);

        if dev
            .framework
            .resolve(
                &mut dev.server_transpiler.resolver,
                &mut dev.client_transpiler.resolver,
                scratch_arena,
            )
            .is_err()
        {
            if dev.framework.is_built_in_react {
                bake::Framework::add_react_install_command_note(&mut dev.log);
            }
            return Err(global.throw_value(dev.log.to_js_aggregate_error(
                global,
                format_args!("Framework is missing required files!"),
            )?));
        }

        // `init_transpiler` snapshots the framework projection, so the
        // transpilers do not see the resolved
        // `server_runtime_import` / `react_fast_refresh.import_source`;
        // re-project after resolve so parser-generated imports (e.g.
        // `serverRuntimeImportSource` in `wrap_exports_for_client_reference`) see
        // absolute paths instead of the user's relative `"./framework/server.ts"`.
        {
            let resolved_view = std::sync::Arc::new(dev.framework.as_bundler_view());
            dev.server_transpiler.options.framework = Some(std::sync::Arc::clone(&resolved_view));
            dev.client_transpiler.options.framework = Some(std::sync::Arc::clone(&resolved_view));
            if let Some(ssr) = &mut dev.ssr_transpiler {
                ssr.options.framework = Some(resolved_view);
            }
        }

        dev.configuration_hash_key = 'hash_key: {
            let mut h = Wyhash::init(128);

            if bun_core::env::IS_DEBUG {
                let stat = match sys::stat(
                    bun_core::self_exe_path()
                        .unwrap_or_else(|e| Output::panic(format_args!("unhandled {}", e))),
                ) {
                    Ok(s) => s,
                    Err(e) => Output::panic(format_args!("unhandled {}", e)),
                };
                // Note: `sys::Stat` is `libc::stat` on POSIX / `uv_stat_t` on
                // Windows (where mtime is `mtim.sec`). Debug-only cache-bust key.
                #[cfg(not(windows))]
                bun_core::write_any_to_hasher(&mut h, stat.st_mtime as i64);
                #[cfg(windows)]
                bun_core::write_any_to_hasher(&mut h, &(stat.mtim.sec as i64));
                h.update(crate::bake::bake_body::get_hmr_runtime(bake::Side::Client).code);
                h.update(crate::bake::bake_body::get_hmr_runtime(bake::Side::Server).code);
            } else {
                h.update(Environment::GIT_SHA_SHORT.as_bytes());
            }

            for fsr in &dev.framework.file_system_router_types {
                bun_core::write_any_to_hasher(&mut h, fsr.allow_layouts as u8);
                bun_core::write_any_to_hasher(&mut h, fsr.ignore_underscores as u8);
                h.update(&fsr.entry_server);
                h.update(&[0]);
                h.update(fsr.entry_client.as_deref().unwrap_or(b""));
                h.update(&[0]);
                h.update(&fsr.prefix);
                h.update(&[0]);
                h.update(&fsr.root);
                h.update(&[0]);
                for ext in &fsr.extensions {
                    h.update(ext);
                    h.update(&[0]);
                }
                h.update(&[0]);
                for dir in &fsr.ignore_dirs {
                    h.update(dir);
                    h.update(&[0]);
                }
                h.update(&[0]);
            }

            if let Some(sc) = &dev.framework.server_components {
                bun_core::write_any_to_hasher(&mut h, 1u8);
                bun_core::write_any_to_hasher(&mut h, sc.separate_ssr_graph as u8);
                h.update(&sc.client_register_server_reference);
                h.update(&[0]);
                h.update(&sc.server_register_client_reference);
                h.update(&[0]);
                h.update(&sc.server_register_server_reference);
                h.update(&[0]);
                h.update(&sc.server_runtime_import);
                h.update(&[0]);
            } else {
                bun_core::write_any_to_hasher(&mut h, 0u8);
            }

            if let Some(rfr) = &dev.framework.react_fast_refresh {
                bun_core::write_any_to_hasher(&mut h, 1u8);
                h.update(&rfr.import_source);
            } else {
                bun_core::write_any_to_hasher(&mut h, 0u8);
            }

            for (k, v) in dev
                .framework
                .built_in_modules
                .keys()
                .iter()
                .zip(dev.framework.built_in_modules.values())
            {
                h.update(k);
                h.update(&[0]);
                // Hash the active tag, then the payload.
                let (tag, data): (u8, &[u8]) = match v {
                    bun_bundler::bake_types::BuiltInModule::Import(d) => (0, &d[..]),
                    bun_bundler::bake_types::BuiltInModule::Code(d) => (1, &d[..]),
                };
                bun_core::write_any_to_hasher(&mut h, tag);
                h.update(data);
                h.update(&[0]);
            }
            h.update(&[0]);

            let mut out = [0u8; 16];
            bun_core::fmt::bytes_to_hex_lower(&h.final_().to_ne_bytes(), &mut out);
            break 'hash_key out;
        };

        // Add react fast refresh if needed. This is the first file on the client side,
        // as it will be referred to by index.
        if let Some(rfr) = &dev.framework.react_fast_refresh {
            let idx = dev.client_graph.insert_stale(
                &mut dev.assets,
                &rfr.import_source,
                bake::Graph::Client,
            )?;
            debug_assert!(idx == incremental_graph::FileIndex::<{ bake::Side::Client }>::init(0));
        }

        if !dev.frontend_only {
            dev.init_server_runtime();
        }

        // Initialize FrameworkRouter
        dev.router = 'router: {
            let mut types: Vec<framework_router::Type> =
                Vec::with_capacity(dev.framework.file_system_router_types.len());

            for i in 0..dev.framework.file_system_router_types.len() {
                let fsr = &dev.framework.file_system_router_types[i];
                let mut buf = paths::path_buffer_pool::get();
                let joined_root = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
                    &dev.root,
                    &mut buf[..],
                    &[&fsr.root],
                );
                let Some(entry) = dev
                    .server_transpiler
                    .resolver
                    .read_dir_info_ignore_error(joined_root)
                else {
                    continue;
                };
                let abs_root: Box<[u8]> = strings::without_trailing_slash(entry.abs_path).into();

                let server_file = dev.server_graph.insert_stale_extra(
                    &mut dev.assets,
                    &fsr.entry_server,
                    bake::Graph::Server,
                    incremental_graph::RouteKind::Route,
                )?;
                let client_file = match &fsr.entry_client {
                    Some(client) => Some(to_opaque_file_id::<{ bake::Side::Client }>(
                        dev.client_graph.insert_stale(
                            &mut dev.assets,
                            client,
                            bake::Graph::Client,
                        )?,
                    )),
                    None => None,
                };

                types.push(framework_router::Type {
                    abs_root,
                    ignore_underscores: fsr.ignore_underscores,
                    ignore_dirs: fsr
                        .ignore_dirs
                        .iter()
                        .map(|d| Box::<[u8]>::from(d.as_ref()))
                        .collect(),
                    extensions: fsr
                        .extensions
                        .iter()
                        .map(|e| Box::<[u8]>::from(e.as_ref()))
                        .collect(),
                    style: fsr.style.clone(),
                    allow_layouts: fsr.allow_layouts,
                    server_file: to_opaque_file_id::<{ bake::Side::Server }>(server_file),
                    client_file,
                    server_file_string: jsc::StrongOptional::empty(),
                });

                dev.route_lookup.put(
                    server_file,
                    RouteIndexAndRecurseFlag::new(
                        framework_router::RouteIndex::init(u32::try_from(i).expect("int cast")),
                        true,
                    ),
                )?;
            }

            break 'router FrameworkRouter::init_empty(&dev.root, types.into_boxed_slice())?;
        };

        // TODO: move scanning to be one tick after server startup. this way the
        // line saying the server is ready shows quicker, and route errors show up
        // after that line.
        dev.scan_initial_routes()?;

        debug_assert!(dev.magic == Magic::Valid);
        Ok(())
    })?;

    Ok(owned)
}

impl Drop for DevServer {
    fn drop(&mut self) {
        debug_log!("deinit");
        DEV_SERVER_DEINIT_COUNT_FOR_TESTING.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        // No route, socket, task or bundler callback may re-enter the cell
        // from here on.
        self.hot_reload.main.lock().dev = None;

        // WebSockets should be deinitialized before other parts. Each socket is
        // detached from this dev server first (its `on_close`, dispatched
        // synchronously by `close()`, then only releases the socket itself).
        for (_, socket) in ::core::mem::take(&mut self.active_websocket_connections) {
            socket.detach_from_dev_server(self);
            if let Some(websocket) = socket.underlying.get() {
                websocket.close();
            }
        }

        if self.memory_visualizer_timer.state == EventLoopTimerState::ACTIVE {
            Self::timer_heap().remove(&raw mut self.memory_visualizer_timer);
        }
        self.graph_safety_lock.lock();
        // Hand the watcher to the watcher thread (which frees it in `thread_main`
        // once `running` flips false) or free it if the thread never started.
        if let Some(watcher) = self.bun_watcher.take() {
            watcher.shutdown_boxed(true);
        }

        if self.current_bundle.is_some() {
            debug_assert!(false); // impossible to de-initialize this state correctly.
        }

        for request in ::core::mem::take(&mut self.next_bundle.requests) {
            debug_assert!(!matches!(*request.handler.get(), Handler::ServerHandler(_)));
            // Ends the response, which still had this request as its abort
            // handler's user-data.
            request.abort();
            DeferredRequest::release(request);
        }
        self.next_bundle.promise.deinit_idempotently();

        for value in self.source_maps.entries.values_mut() {
            debug_assert!(value.ref_count > 0);
            value.ref_count = 0;
        }
        if self.source_maps.weak_ref_sweep_timer.state == EventLoopTimerState::ACTIVE {
            Self::timer_heap().remove(&raw mut self.source_maps.weak_ref_sweep_timer);
        }

        if let TestingBatchEvents::Enabled(batch) = &mut self.testing_batch_events {
            drop(std::mem::replace(
                &mut batch.entry_points,
                EntryPointList::empty(),
            ));
        }

        debug_assert!(self.magic == Magic::Valid);
    }
}

impl DevServer {
    fn init_server_runtime(&mut self) {
        let runtime = BunString::create_static_external(
            crate::bake::bake_body::get_hmr_runtime(crate::bake::bake_body::Side::Server)
                .code
                .as_bytes(),
            true,
        );

        // `self.global()` returns `&'static`, decoupled from `&self` — it's
        // held across the `&mut self` field assignments below.
        let global = self.global();
        let interface = match c::bake_load_initial_server_code(
            global,
            runtime,
            self.framework
                .server_components
                .as_ref()
                .map(|sc| sc.separate_ssr_graph)
                .unwrap_or(false),
        ) {
            Ok(v) => v,
            Err(err) => {
                self.vm_mut()
                    .print_error_like_object_to_console(global.take_exception(err));
                panic!("Server runtime failed to start. The above error is always a bug in Bun");
            }
        };

        if !interface.is_object() {
            panic!(
                "Internal assertion failure: expected interface from HMR runtime to be an object"
            );
        }
        let fetch_function = interface
            .get(global, "handleRequest")
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                panic!("Internal assertion failure: expected interface from HMR runtime to contain handleRequest")
            });
        debug_assert!(fetch_function.is_callable());
        self.server_fetch_function_callback = jsc::StrongOptional::create(fetch_function, global);
        let register_update = interface
            .get(global, "registerUpdate")
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                panic!("Internal assertion failure: expected interface from HMR runtime to contain registerUpdate")
            });
        self.server_register_update_callback = jsc::StrongOptional::create(register_update, global);

        fetch_function.ensure_still_alive();
        register_update.ensure_still_alive();
    }

    /// Deferred one tick so that the server can be up faster
    fn scan_initial_routes(&mut self) -> crate::Result<()> {
        let mut ctx = RouterInsertionCtx {
            server_graph: &mut self.server_graph,
            assets: &mut self.assets,
            route_lookup: &mut self.route_lookup,
            root: &self.root,
        };
        self.router.scan_all(
            &mut self.server_transpiler.resolver,
            framework_router::InsertionContext::wrap(&mut ctx),
        )?;

        self.server_graph.ensure_stale_bit_capacity(true)?;
        self.client_graph.ensure_stale_bit_capacity(true)?;
        Ok(())
    }

    /// Returns true if a catch-all handler was attached.
    pub(crate) fn set_routes<const SSL: bool, const DEBUG: bool>(
        &mut self,
        server: &crate::server::NewServer<SSL, DEBUG>,
    ) -> crate::Result<bool> {
        // TODO: all paths here must be prefixed with publicPath if set.
        debug_assert!(self.server == AnyServer::from(server));
        let this = self.this();
        let app = server.app_mut().expect("server app is live");
        use bun_http_types::Method::Method;
        app.method_this(
            Method::GET,
            const_format::concatcp!(CLIENT_PREFIX, "/:route").as_bytes(),
            dev_route::<{ DevHandlerId::JsRequest }>,
            this,
        );
        app.method_this(
            Method::GET,
            const_format::concatcp!(ASSET_PREFIX, "/:asset").as_bytes(),
            dev_route::<{ DevHandlerId::AssetRequest }>,
            this,
        );
        app.method_this(
            Method::GET,
            const_format::concatcp!(INTERNAL_PREFIX, "/src/*").as_bytes(),
            dev_route::<{ DevHandlerId::SrcRequest }>,
            this,
        );
        app.method_this(
            Method::POST,
            const_format::concatcp!(INTERNAL_PREFIX, "/report_error").as_bytes(),
            dev_route::<{ DevHandlerId::ReportError }>,
            this,
        );
        app.method_this(
            Method::POST,
            const_format::concatcp!(INTERNAL_PREFIX, "/unref").as_bytes(),
            dev_route::<{ DevHandlerId::UnrefSourceMap }>,
            this,
        );
        app.any_this(
            INTERNAL_PREFIX.as_bytes(),
            dev_route::<{ DevHandlerId::NotFound }>,
            this,
        );

        app.ws_this::<DevServerCell, HmrSocket>(
            const_format::concatcp!(INTERNAL_PREFIX, "/hmr").as_bytes(),
            this,
            0,
            &Default::default(),
        );

        // Only attach a catch-all handler if the framework has filesystem
        // router types. Otherwise, this can just be Bun.serve's default handler.
        if !self.framework.file_system_router_types.is_empty() {
            app.any_this(b"/*", dev_route::<{ DevHandlerId::Request }>, this);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

/// Handler dispatch for `dev_route`. A fn pointer cannot be a const
/// generic, so use a `ConstParamTy` enum instead and
/// `match` inside the trampoline (the optimizer folds the constant `match`).
#[derive(Copy, Clone, Eq, PartialEq, ::core::marker::ConstParamTy)]
pub(super) enum DevHandlerId {
    JsRequest,
    AssetRequest,
    SrcRequest,
    ReportError,
    UnrefSourceMap,
    NotFound,
    Request,
}

/// DNS-rebinding guard for `/_bun/...` internal routes and the Chrome
/// DevTools `/.well-known/...` route. A rebound origin
/// (`attacker.com` → 127.0.0.1) presents `Host: attacker.com`; rejecting
/// non-loopback / non-IP / non-configured hostnames prevents the attacker's
/// page from reading bundled source via same-origin fetch.
pub(crate) fn is_allowed_dev_host(dev: &DevServer, req: &Request) -> bool {
    is_allowed_host_header(req, Some(&dev.server.config().address))
}

pub(crate) fn is_allowed_host_header(
    req: &Request,
    address: Option<&crate::server::server_config::Address>,
) -> bool {
    let Some(host) = req.header(b"host") else {
        return false;
    };
    let host = host_without_port(host);
    if strings::eql_case_insensitive_ascii(host, b"localhost", true) {
        return true;
    }
    const DOT_LOCALHOST: &[u8] = b".localhost";
    if host.len() > DOT_LOCALHOST.len()
        && strings::eql_case_insensitive_ascii(
            &host[host.len() - DOT_LOCALHOST.len()..],
            DOT_LOCALHOST,
            true,
        )
    {
        return true;
    }
    let ip = if host.first() == Some(&b'[') && host.last() == Some(&b']') {
        &host[1..host.len() - 1]
    } else {
        host
    };
    if bun_core::ip_address::is_ip_address(ip) {
        return true;
    }
    if let Some(crate::server::server_config::Address::Tcp {
        hostname: Some(h), ..
    }) = address
    {
        return strings::eql_case_insensitive_ascii(host, h.as_bytes(), true);
    }
    false
}

/// `host[":" port]` / `"[" v6 "]" [":" port]` → host (brackets retained for IPv6).
/// Malformed authorities (missing `]`, empty or non-numeric port, trailing
/// garbage) yield an empty slice so callers fail closed.
fn host_without_port(host: &[u8]) -> &[u8] {
    let (host, rest) = if host.first() == Some(&b'[') {
        match strings::index_of_scalar(host, b']') {
            Some(end) => (&host[..=end], &host[end + 1..]),
            None => return b"",
        }
    } else {
        match strings::last_index_of_char(host, b':') {
            Some(colon) => (&host[..colon], &host[colon..]),
            None => (host, &host[host.len()..]),
        }
    };
    match rest {
        [] => host,
        [b':', port @ ..] if !port.is_empty() && port.iter().all(u8::is_ascii_digit) => host,
        _ => b"",
    }
}

/// Cross-origin guard for the HMR WebSocket. WebSocket handshakes are exempt
/// from the same-origin policy, so any page the developer visits could open
/// `ws://localhost:<port>/_bun/hmr` and subscribe to hot-update payloads (the
/// bundled source) — the browser still sends `Host: localhost`, so
/// `is_allowed_dev_host` alone does not stop it. Browsers always include an
/// `Origin` header on WebSocket handshakes; require its host to be the
/// request's own host or a localhost name. Requests without an `Origin`
/// header (non-browser clients) are allowed.
fn is_allowed_dev_origin(req: &Request) -> bool {
    let Some(origin) = req.header(b"origin") else {
        return true;
    };
    // An origin is `scheme "://" host [":" port]`; opaque origins serialize
    // to `null` and are rejected here.
    let Some(scheme_end) = strings::index_of(origin, b"://") else {
        return false;
    };
    let origin_host = host_without_port(&origin[scheme_end + 3..]);
    if strings::eql_case_insensitive_ascii(origin_host, b"localhost", true) {
        return true;
    }
    const DOT_LOCALHOST: &[u8] = b".localhost";
    if origin_host.len() > DOT_LOCALHOST.len()
        && strings::eql_case_insensitive_ascii(
            &origin_host[origin_host.len() - DOT_LOCALHOST.len()..],
            DOT_LOCALHOST,
            true,
        )
    {
        return true;
    }
    match req.header(b"host") {
        Some(host) => {
            strings::eql_case_insensitive_ascii(origin_host, host_without_port(host), true)
        }
        None => false,
    }
}

fn host_forbidden(resp: AnyResponse) {
    resp.corked(move || {
        resp.write_status(b"403 Forbidden");
        resp.end(b"Blocked: Host header does not match the dev server", false);
    });
}

fn origin_forbidden(resp: AnyResponse) {
    resp.corked(move || {
        resp.write_status(b"403 Forbidden");
        resp.end(
            b"Blocked: Origin header does not match the dev server",
            false,
        );
    });
}

/// Route handler registered with `App::method_this` / `any_this` for each
/// `/_bun/*` route (and the catch-all): applies the Host/Origin guards, then
/// runs the handler for `ID` on the dev server.
fn dev_route<const ID: DevHandlerId>(
    this: bun_ptr::ThisPtr<DevServerCell>,
    req: bun_uws::AnyRequest,
    resp: AnyResponse,
) {
    let bun_uws::AnyRequest::H1(req) = req else {
        return not_found(resp);
    };
    let req = bun_opaque::opaque_deref_mut(req);
    if !is_allowed_dev_host(this.get().get(), req) {
        return host_forbidden(resp);
    }
    if matches!(ID, DevHandlerId::ReportError | DevHandlerId::UnrefSourceMap)
        && !is_allowed_dev_origin(req)
    {
        return origin_forbidden(resp);
    }
    let cell = this.get();
    match ID {
        DevHandlerId::JsRequest => cell.with_mut(|dev| on_js_request(dev, req, resp)),
        DevHandlerId::AssetRequest => cell.with_mut(|dev| on_asset_request(dev, req, resp)),
        DevHandlerId::SrcRequest => cell.with_mut(|dev| on_src_request(dev, req, resp)),
        DevHandlerId::ReportError => cell.with_mut(|dev| on_report_error_request(dev, req, resp)),
        DevHandlerId::UnrefSourceMap => {
            cell.with_mut(|dev| on_unref_source_map_request(dev, req, resp))
        }
        DevHandlerId::NotFound => cell.with_mut(|dev| on_not_found(dev, req, resp)),
        DevHandlerId::Request => {
            // The catch-all route can reach a framework request handler; this
            // is where what bundling for it left pending is folded. The user's
            // JS runs after the dev server borrow ends.
            let server = cell.get().server;
            let result = match on_request(cell, req, resp) {
                Ok(RequestAction::Done) => Ok(()),
                Ok(RequestAction::UserHandler) => {
                    server.on_request(req, resp);
                    Ok(())
                }
                Ok(RequestAction::Framework(call)) => {
                    call.run(server, SavedRequestUnion::Stack(req), resp);
                    Ok(())
                }
                Err(err) => Err(err),
            };
            crate::dispatch::fold(result);
        }
    }
}

/// What the catch-all route handler does once the dev server borrow ends.
enum RequestAction {
    Done,
    /// Fall through to `Bun.serve`'s `fetch` handler.
    UserHandler,
    /// Call the framework's request handler.
    Framework(FrameworkCall),
}

/// A ready-to-run call into the framework's `handleRequest` (server JS).
pub(crate) struct FrameworkCall {
    callback: JSValue,
    args: FrameworkRequestArgs,
}

impl FrameworkCall {
    fn run(self, server: AnyServer, req: SavedRequestUnion<'_>, resp: AnyResponse) {
        let args = self.args;
        server.on_saved_request(
            req,
            resp,
            self.callback,
            [
                args.router_type_main,
                args.route_modules,
                args.client_id,
                args.styles,
                args.params,
                args.set_async_local_storage,
                args.bundle_new_route,
                args.new_route_params,
            ],
        );
    }
}

fn on_report_error_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    use bun_uws_sys::thunk::OpaqueHandle as _;
    match resp {
        AnyResponse::SSL(r) => {
            ErrorReportRequest::run(dev, req, bun_uws_sys::response::TLSResponse::as_handle(r))
        }
        AnyResponse::TCP(r) => {
            ErrorReportRequest::run(dev, req, bun_uws_sys::response::TCPResponse::as_handle(r))
        }
        AnyResponse::H3(_) | AnyResponse::H2(_) => not_found(resp),
    }
}

fn on_unref_source_map_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    use bun_uws_sys::thunk::OpaqueHandle as _;
    match resp {
        AnyResponse::SSL(r) => {
            UnrefSourceMapRequest::run(dev, req, bun_uws_sys::response::TLSResponse::as_handle(r))
        }
        AnyResponse::TCP(r) => {
            UnrefSourceMapRequest::run(dev, req, bun_uws_sys::response::TCPResponse::as_handle(r))
        }
        AnyResponse::H3(_) | AnyResponse::H2(_) => not_found(resp),
    }
}

// `App::ws_this::<DevServerCell, HmrSocket>` requires `HmrSocket` to be a
// `WebSocketHandlerRef` (see `dev_server::hmr_socket`) and `DevServerCell` to
// be a `WebSocketUpgradeServer<SSL>`.
impl<const SSL: bool> bun_uws_sys::web_socket::WebSocketUpgradeServer<SSL> for DevServerCell {
    fn on_websocket_upgrade(
        this: bun_ptr::ThisPtr<Self>,
        res: &mut bun_uws_sys::NewAppResponse<SSL>,
        req: &mut Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        debug_assert_eq!(id, 0);
        if !is_allowed_dev_host(this.get().get(), req) {
            host_forbidden(res.as_any_response());
            return;
        }
        if !is_allowed_dev_origin(req) {
            origin_forbidden(res.as_any_response());
            return;
        }
        let socket = bun_ptr::RefPtr::new(HmrSocket::new(bun_ptr::BackRef::new(this.get())));
        this.get().with_mut(|dev| {
            dev.active_websocket_connections
                .insert(socket.as_ptr() as usize, socket.clone())
        });
        // `res.upgrade_ref(..)` synchronously runs `HmrSocket::on_open`, which
        // enters the dev server itself, so no `with_mut` may span it.
        let _ = res.upgrade_ref(
            socket,
            req.header(b"sec-websocket-key").unwrap_or(b""),
            req.header(b"sec-websocket-protocol").unwrap_or(b""),
            req.header(b"sec-websocket-extension").unwrap_or(b""),
            Some(upgrade_ctx),
        );
    }
}

// `ResponseLike` for the concrete `Response<SSL>` (used by `on_websocket_upgrade`).
impl<const SSL: bool> ResponseLike for bun_uws_sys::response::Response<SSL> {
    fn write_status(&mut self, status: &[u8]) {
        bun_uws_sys::response::Response::<SSL>::write_status(self, status)
    }
    fn end(&mut self, data: &[u8], close_connection: bool) {
        bun_uws_sys::response::Response::<SSL>::end(self, data, close_connection)
    }
    fn as_any_response(&mut self) -> bun_uws::AnyResponse {
        if SSL {
            bun_uws::AnyResponse::SSL(std::ptr::from_mut::<Self>(self).cast())
        } else {
            bun_uws::AnyResponse::TCP(std::ptr::from_mut::<Self>(self).cast())
        }
    }
}

fn on_not_found(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    not_found(resp);
}

fn not_found(resp: AnyResponse) {
    resp.corked(move || on_not_found_corked(resp));
}

fn on_not_found_corked(resp: AnyResponse) {
    resp.write_status(b"404 Not Found");
    resp.end(b"Not Found", false);
}

fn on_outdated_js_corked(resp: AnyResponse) {
    // Send a payload to instantly reload the page. This only happens when the
    // client bundle is invalidated while the page is loading, aka when you
    // perform many file updates that cannot be hot-updated.
    resp.write_status(b"200 OK");
    resp.write_header(b"Content-Type", &MimeType::JAVASCRIPT.value);
    resp.end(
        b"try{location.reload()}catch(_){}\n\
         addEventListener(\"DOMContentLoaded\",function(event){location.reload()})",
        false,
    );
}

fn on_js_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    let route_id = req.parameter(0);
    let is_map = strings::has_suffix_comptime(route_id, b".js.map");
    if !is_map && !strings::has_suffix_comptime(route_id, b".js") {
        return not_found(resp);
    }
    let min_len = b"00000000FFFFFFFF.js".len() + if is_map { b".map".len() } else { 0 };
    if route_id.len() < min_len {
        return not_found(resp);
    }
    let hex = &route_id[route_id.len() - min_len..][..::core::mem::size_of::<u64>() * 2];
    let Some(id) = parse_hex_to_int::<u64>(hex) else {
        return not_found(resp);
    };

    if is_map {
        let source_id = source_map_store::SourceId(id);
        let Some(entry) = dev
            .source_maps
            .entries
            .get(&source_map_store::Key::init(id))
        else {
            return not_found(resp);
        };
        let json_bytes = match entry.render_json(source_id.kind(), bake::Side::Client) {
            Ok(b) => b,
            Err(e) => bun_core::handle_oom(Err(e)),
        };
        let response = StaticRoute::init_from_any_blob(
            crate::webcore::blob::Any::from_array_list(json_bytes),
            crate::server::static_route::InitFromBytesOptions {
                server: Some(dev.server),
                mime_type: Some(&MimeType::JSON),
                ..Default::default()
            },
        );
        StaticRoute::on_request(response.this_ptr(), bun_uws::AnyRequest::H1(req), resp);
        return;
    }

    let route_bundle_index =
        route_bundle::Index::init(u32::try_from(id & 0xFFFFFFFF).expect("int cast"));
    let generation: u32 = u32::try_from(id >> 32).expect("int cast");

    if route_bundle_index.get() as usize >= dev.route_bundles.len() {
        return not_found(resp);
    }

    let route_bundle = &dev.route_bundles[route_bundle_index.get() as usize];
    if route_bundle.client_script_generation != generation
        || route_bundle.server_state != route_bundle::State::Loaded
    {
        return resp.corked(move || on_outdated_js_corked(resp));
    }

    dev.on_js_request_with_bundle(
        route_bundle_index,
        resp,
        Method::which(req.method()).unwrap_or(Method::POST),
    );
}

fn on_asset_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    let param = req.parameter(0);
    if param.len() < ::core::mem::size_of::<u64>() * 2 {
        return not_found(resp);
    }
    let hex = &param[..::core::mem::size_of::<u64>() * 2];
    let Some(hash) = parse_hex_to_int::<u64>(hex) else {
        return not_found(resp);
    };
    debug_log!("onAssetRequest {} {}", hash, bstr::BStr::new(param));
    let Some(asset) = dev.assets.get(hash) else {
        return not_found(resp);
    };
    req.set_yield(false);
    StaticRoute::on(asset.this_ptr(), resp);
}

pub(super) use bun_core::fmt::parse_hex_to_int;

fn on_src_request(_dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    if req.header(b"open-in-editor").is_none() {
        resp.write_status(b"501 Not Implemented");
        resp.end(
            b"Viewing source without opening in editor is not implemented yet!",
            false,
        );
        return;
    }

    // TODO: better editor detection. on chloe's dev env, this opens apple terminal + vim
    resp.write_status(b"501 Not Implemented");
    resp.end(b"TODO", false);
}

struct RequestEnsureRouteBundledCtx {
    req: ReqOrSaved,
    resp: AnyResponse,
    kind: deferred_request::HandlerKind,
    route_bundle_index: route_bundle::Index,
    /// Set by `on_loaded` for a framework route: the caller runs it once the
    /// dev server borrow ends.
    framework_call: Option<FrameworkCall>,
}

impl EnsureRouteCtx for RequestEnsureRouteBundledCtx {
    fn on_defer(&mut self, dev: &mut DevServer, bundle_field: BundleQueueType) -> JsResult<()> {
        let req = ::core::mem::replace(&mut self.req, ReqOrSaved::Aborted);
        dev.defer_request(
            bundle_field,
            self.route_bundle_index,
            self.kind,
            req,
            self.resp,
        )?;
        Ok(())
    }

    fn on_loaded(&mut self, dev: &mut DevServer) -> JsResult<()> {
        match self.kind {
            deferred_request::HandlerKind::ServerHandler => {
                let ReqOrSaved::Req(r) = self.req else {
                    unreachable!()
                };
                let url = bun_opaque::opaque_deref_mut(r).url();
                self.framework_call =
                    Some(dev.prepare_framework_request(self.route_bundle_index, url)?);
                Ok(())
            }
            deferred_request::HandlerKind::BundledHtmlPage => {
                dev.on_html_request_with_bundle(
                    self.route_bundle_index,
                    self.resp,
                    self.req.method(),
                );
                Ok(())
            }
        }
    }

    fn on_plugin_error(&mut self, _dev: &mut DevServer) -> JsResult<()> {
        self.resp.end(b"Plugin Error", false);
        Ok(())
    }

    fn to_dev_response(&mut self, _dev: &mut DevServer) -> DevResponse<'_> {
        DevResponse::Http(self.resp)
    }
}

#[derive(Copy, Clone)]
enum BundleQueueType {
    NextBundle,
    CurrentBundle,
}

trait EnsureRouteCtx {
    fn on_defer(&mut self, dev: &mut DevServer, bundle_field: BundleQueueType) -> JsResult<()>;
    fn on_loaded(&mut self, dev: &mut DevServer) -> JsResult<()>;
    fn on_plugin_error(&mut self, dev: &mut DevServer) -> JsResult<()>;
    fn to_dev_response(&mut self, dev: &mut DevServer) -> DevResponse<'_>;
}

/// What `ensure_route_is_bundled_step` needs done outside the dev server
/// borrow before it can continue.
enum EnsureRouteStep {
    Done,
    /// Ask the server for its plugins (which may evaluate them — user JS).
    LoadPlugins,
    /// Bundle this route now.
    StartBundle(EntryPointList),
}

fn ensure_route_is_bundled<Ctx: EnsureRouteCtx>(
    cell: &DevServerCell,
    route_bundle_index: route_bundle::Index,
    ctx: &mut Ctx,
) -> JsResult<()> {
    loop {
        match cell.with_mut(|dev| ensure_route_is_bundled_step(dev, route_bundle_index, ctx))? {
            EnsureRouteStep::Done => return Ok(()),
            EnsureRouteStep::StartBundle(entry_points) => {
                DevServer::start_async_bundle(
                    cell,
                    BundleRequest {
                        entry_points,
                        had_reload_event: false,
                        timer: Instant::now(),
                    },
                )
                .expect("oom");
                return Ok(());
            }
            EnsureRouteStep::LoadPlugins => {
                let server = cell.get().server;
                let load_result =
                    server.get_or_load_plugins(crate::server::ServePluginsCallback::DevServer);
                cell.with_mut(|dev| match load_result {
                    crate::server::GetOrStartLoadResult::Pending => {
                        // A synchronously settled load already moved this on.
                        if dev.plugin_state == PluginState::Unknown {
                            dev.plugin_state = PluginState::Pending;
                        }
                    }
                    crate::server::GetOrStartLoadResult::Err => {
                        dev.plugin_state = PluginState::Err;
                    }
                    crate::server::GetOrStartLoadResult::Ready(ready) => {
                        dev.plugin_state = PluginState::Loaded;
                        dev.bundler_options.plugin = ready.map(::core::ptr::NonNull::from);
                    }
                });
            }
        }
    }
}

fn ensure_route_is_bundled_step<Ctx: EnsureRouteCtx>(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    ctx: &mut Ctx,
) -> JsResult<EnsureRouteStep> {
    debug_assert!(dev.magic == Magic::Valid);
    let mut state = dev.route_bundle_ptr(route_bundle_index).server_state;
    'sw: loop {
        match state {
            route_bundle::State::Unqueued => {
                // We already are bundling something, defer the request
                if dev.current_bundle.is_some() {
                    dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                    ctx.on_defer(dev, BundleQueueType::NextBundle)?;
                    dev.route_bundle_ptr(route_bundle_index).server_state =
                        route_bundle::State::DeferredToNextBundle;
                    return Ok(EnsureRouteStep::Done);
                }

                // No current bundle, we'll create a bundle with just this route, but first:
                // If plugins are not yet loaded, prepare them.
                match dev.plugin_state {
                    PluginState::Unknown => {
                        if dev.bundler_options.plugin.is_some() {
                            // Framework-provided plugin is likely going to be phased out later
                            dev.plugin_state = PluginState::Loaded;
                        } else {
                            // TODO: implement a proper solution here
                            let has_tailwind = if let Some(serve_plugins) =
                                &dev.vm().transpiler.options.serve_plugins
                            {
                                serve_plugins
                                    .iter()
                                    .find(|p| strings::includes(p, b"tailwind"))
                                    .map(|_| Default::default())
                            } else {
                                None
                            };
                            dev.has_tailwind_plugin_hack = has_tailwind;
                            // Comes back here with `plugin_state` moved on.
                            return Ok(EnsureRouteStep::LoadPlugins);
                        }
                    }
                    PluginState::Pending => {
                        dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                        ctx.on_defer(dev, BundleQueueType::NextBundle)?;
                        dev.route_bundle_ptr(route_bundle_index).server_state =
                            route_bundle::State::DeferredToNextBundle;
                        return Ok(EnsureRouteStep::Done);
                    }
                    PluginState::Err => {
                        // TODO: render plugin error page
                        ctx.on_plugin_error(dev)?;
                        return Ok(EnsureRouteStep::Done);
                    }
                    PluginState::Loaded => {}
                }

                // Prepare a bundle with just this route.
                let mut entry_points = EntryPointList::empty();
                dev.append_route_entry_points_if_not_stale(&mut entry_points, route_bundle_index)?;

                // If all files were already bundled (possible with layouts),
                // then no entry points will be queued up here. That does
                // not mean the route is ready for presentation.
                if entry_points.set.is_empty() {
                    if !dev.bundling_failures.is_empty() {
                        dev.route_bundle_ptr(route_bundle_index).server_state =
                            route_bundle::State::PossibleBundlingFailures;
                        state = route_bundle::State::PossibleBundlingFailures;
                        continue 'sw;
                    } else {
                        dev.route_bundle_ptr(route_bundle_index).server_state =
                            route_bundle::State::Loaded;
                        state = route_bundle::State::Loaded;
                        continue 'sw;
                    }
                }

                dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                ctx.on_defer(dev, BundleQueueType::NextBundle)?;
                dev.route_bundle_ptr(route_bundle_index).server_state =
                    route_bundle::State::Bundling;

                return Ok(EnsureRouteStep::StartBundle(entry_points));
            }
            route_bundle::State::DeferredToNextBundle => {
                debug_assert!(
                    dev.next_bundle
                        .route_queue
                        .get(&route_bundle_index)
                        .is_some()
                );
                ctx.on_defer(dev, BundleQueueType::NextBundle)?;
                return Ok(EnsureRouteStep::Done);
            }
            route_bundle::State::Bundling => {
                debug_assert!(dev.current_bundle.is_some());
                ctx.on_defer(dev, BundleQueueType::CurrentBundle)?;
                return Ok(EnsureRouteStep::Done);
            }
            route_bundle::State::PossibleBundlingFailures => {
                if !dev.bundling_failures.is_empty() {
                    // Trace the graph to see if there are any failures that are
                    // reachable by this route.
                    let resp = ctx.to_dev_response(dev);
                    match check_route_failures(dev, route_bundle_index, resp)? {
                        CheckResult::Stop => return Ok(EnsureRouteStep::Done),
                        CheckResult::Ok => {} // Errors were cleared or not in the way.
                        CheckResult::Rebuild => {
                            state = route_bundle::State::Unqueued;
                            continue 'sw;
                        }
                    }
                }

                dev.route_bundle_ptr(route_bundle_index).server_state = route_bundle::State::Loaded;
                state = route_bundle::State::Loaded;
                continue 'sw;
            }
            route_bundle::State::Loaded => {
                ctx.on_loaded(dev)?;
                return Ok(EnsureRouteStep::Done);
            }
        }
    }
}

#[derive(Clone, Copy)]
enum ReqOrSaved {
    Req(*mut Request), // FFI: uws C request ptr from handler callback
    Aborted,
}

impl ReqOrSaved {
    fn method(&self) -> Method {
        match self {
            ReqOrSaved::Req(req) => {
                Method::which(bun_opaque::opaque_deref_mut(*req).method()).unwrap_or(Method::POST)
            }
            ReqOrSaved::Aborted => unreachable!(),
        }
    }
}

impl DevServer {
    fn defer_request(
        &mut self,
        bundle_field: BundleQueueType,
        route_bundle_index: route_bundle::Index,
        kind: deferred_request::HandlerKind,
        req: ReqOrSaved,
        resp: AnyResponse,
    ) -> crate::Result<()> {
        let method = match &req {
            ReqOrSaved::Req(r) => {
                Method::which(bun_opaque::opaque_deref_mut(*r).method()).unwrap_or(Method::GET)
            }
            _ => unreachable!(),
        };

        let handler = match kind {
            deferred_request::HandlerKind::BundledHtmlPage => {
                Handler::BundledHtmlPage(ResponseAndMethod {
                    response: resp,
                    method,
                })
            }
            deferred_request::HandlerKind::ServerHandler => {
                let ReqOrSaved::Req(r) = req else {
                    unreachable!()
                };
                let global = self.vm().global();
                match self.server.prepare_and_save_js_request_context(
                    bun_opaque::opaque_deref_mut(r),
                    resp,
                    global,
                    Some(method),
                )? {
                    Some(saved) => Handler::ServerHandler(saved),
                    // Abort the deferral on failure.
                    None => return Ok(()),
                }
            }
        };
        let deferred = bun_ptr::RefPtr::new(DeferredRequest {
            ref_count: Cell::new(1),
            route_bundle_index,
            handled: Cell::new(false),
            handler: JsCell::new(handler),
        });
        debug_log!("DeferredRequest(0x{:x}).init", deferred.as_ptr() as usize);

        match deferred.handler.get() {
            Handler::BundledHtmlPage(_) => {
                // Cleared by whatever answers the response (`StaticRoute`,
                // `abort()`), which happens before the lists release their ref.
                resp.on_aborted_this(
                    |this: bun_ptr::ThisPtr<DeferredRequest>, _: AnyResponse| this.on_abort(),
                    deferred.this_ptr(),
                );
            }
            Handler::ServerHandler(saved) => {
                saved.ctx.ref_();
                saved.ctx.set_additional_on_abort_callback(Some(
                    crate::server::any_request_context::AdditionalOnAbortCallback(deferred.clone()),
                ));
            }
            Handler::Aborted => unreachable!(),
        }

        let requests = match bundle_field {
            BundleQueueType::CurrentBundle => {
                &mut self
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active")
                    .requests
            }
            BundleQueueType::NextBundle => &mut self.next_bundle.requests,
        };
        requests.push(deferred);
        Ok(())
    }
}

enum CheckResult {
    Stop,
    Ok,
    Rebuild,
}

fn check_route_failures(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    resp: DevResponse,
) -> crate::Result<CheckResult> {
    let mut gts = dev.init_graph_trace_state(0)?;
    let mut dev = scopeguard::guard(dev, |dev| {
        dev.incremental_result.failures_added.clear();
    });
    let _lock_guard = dev.graph_safety_lock.guard();
    let key = dev.route_bundles[route_bundle_index.get() as usize].trace_key();
    dev.trace_all_route_imports(key, &mut gts, TraceImportGoal::FindErrors)?;
    if !dev.incremental_result.failures_added.is_empty() {
        // See comment on this field for information
        if !dev.assume_perfect_incremental_bundling {
            // Cache bust EVERYTHING reachable
            {
                let mut it = gts.client_bits.iterator::<true, true>();
                while let Some(file_index) = it.next() {
                    dev.client_graph.stale_files.set(file_index);
                }
            }
            {
                let mut it = gts.server_bits.iterator::<true, true>();
                while let Some(file_index) = it.next() {
                    dev.server_graph.stale_files.set(file_index);
                }
            }
            return Ok(CheckResult::Rebuild);
        }

        dev.send_serialized_failures(resp, &dev.incremental_result.failures_added, None)?;
        Ok(CheckResult::Stop)
    } else {
        // Failures are unreachable by this route, so it is OK to load.
        Ok(CheckResult::Ok)
    }
}

impl DevServer {
    fn append_route_entry_points_if_not_stale(
        &mut self,
        entry_points: &mut EntryPointList,
        rbi: route_bundle::Index,
    ) -> crate::Result<()> {
        let server_file_names = self.server_graph.bundled_files.keys();
        let client_file_names = self.client_graph.bundled_files.keys();

        // Build a list of all files that have not yet been bundled.
        match &self.route_bundles[rbi.get() as usize].data {
            route_bundle::Data::Framework(bundle) => {
                let mut route = self.router.route_ptr(bundle.route_index);
                let router_type = self.router.type_ptr_const(route.r#type);
                let (rt_server_file, rt_client_file) =
                    (router_type.server_file, router_type.client_file);
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    OpaqueFileIdOrOptional::Id(rt_server_file),
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Client }>(
                    client_file_names,
                    entry_points,
                    rt_client_file,
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    route.file_page,
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    route.file_layout,
                )?;
                while let Some(parent_index) = route.parent {
                    route = self.router.route_ptr(parent_index);
                    self.append_opaque_entry_point::<{ bake::Side::Server }>(
                        server_file_names,
                        entry_points,
                        route.file_layout,
                    )?;
                }
            }
            route_bundle::Data::Html(html) => {
                entry_points.append_html(&html.html_bundle.bundle.path)?;
            }
        }

        if let Some(map) = &self.has_tailwind_plugin_hack {
            for abs_path in map.keys() {
                let Some(file) = self.client_graph.bundled_files.get(abs_path) else {
                    continue;
                };
                if file.kind == FileKind::Css {
                    entry_points.append_css(abs_path).expect("oom");
                }
            }
        }
        Ok(())
    }
}

// C++ side defines `extern "C" SYSV_ABI` (BakeAdditionsToGlobalObject.cpp).
bun_jsc::jsc_abi_extern! {
    safe fn Bake__getEnsureAsyncLocalStorageInstanceJSFunction(global: &JSGlobalObject) -> JSValue;
    safe fn Bake__getBundleNewRouteJSFunction(global: &JSGlobalObject) -> JSValue;
    safe fn Bake__getNewRouteParamsJSFunction(global: &JSGlobalObject) -> JSValue;
}

struct FrameworkRequestArgs {
    router_type_main: JSValue,
    route_modules: JSValue,
    client_id: JSValue,
    styles: JSValue,
    params: JSValue,
    bundle_new_route: JSValue,
    new_route_params: JSValue,
    set_async_local_storage: JSValue,
}

impl DevServer {
    /// The `Framework` payload of `route_bundles[rbi]`.
    fn framework_bundle_mut(&mut self, rbi: route_bundle::Index) -> &mut route_bundle::Framework {
        match &mut self.route_bundles[rbi.get() as usize].data {
            route_bundle::Data::Framework(f) => f,
            route_bundle::Data::Html(_) => unreachable!("expected .framework"),
        }
    }

    fn compute_arguments_for_framework_request(
        &mut self,
        route_bundle_index: route_bundle::Index,
        params_js_value: JSValue,
        first_request: bool,
    ) -> JsResult<FrameworkRequestArgs> {
        let global = self.global();
        let (route_index, cached_module_list, cached_client_bundle_url, cached_css_file_array) = {
            let fw = self.framework_bundle_mut(route_bundle_index);
            (
                fw.route_index,
                fw.cached_module_list.get(),
                fw.cached_client_bundle_url.get(),
                fw.cached_css_file_array.get(),
            )
        };
        let route_type_idx = self.router.route_ptr(route_index).r#type;
        let client_script_generation: u32 =
            self.route_bundles[route_bundle_index.get() as usize].client_script_generation;

        Ok(FrameworkRequestArgs {
            // routerTypeMain
            router_type_main: match self
                .router
                .type_ptr_const(route_type_idx)
                .server_file_string
                .get()
            {
                Some(s) => s,
                None => 'str: {
                    let server_file = self.router.type_ptr_const(route_type_idx).server_file;
                    let name = &self.server_graph.bundled_files.keys()
                        [from_opaque_file_id::<{ bake::Side::Server }>(server_file).get() as usize];
                    let mut buf = paths::path_buffer_pool::get();
                    let s = bun_string_jsc::create_utf8_for_js(
                        global,
                        self.relative_path(&mut buf, name),
                    )?;
                    self.router.type_ptr(route_type_idx).server_file_string =
                        jsc::StrongOptional::create(s, global);
                    break 'str s;
                }
            },
            // routeModules
            route_modules: match cached_module_list {
                Some(a) => a,
                None => 'arr: {
                    let keys = self.server_graph.bundled_files.keys();
                    let mut n: usize = 1;
                    let mut route = self.router.route_ptr(route_index);
                    loop {
                        if route.file_layout.is_some() {
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = self.router.route_ptr(p);
                    }
                    let arr = JSValue::create_empty_array(global, n)?;
                    route = self.router.route_ptr(route_index);
                    {
                        let mut buf = paths::path_buffer_pool::get();
                        let route_name = self.relative_path(
                            &mut buf,
                            &keys[from_opaque_file_id::<{ bake::Side::Server }>(
                                route.file_page.unwrap(),
                            )
                            .get() as usize],
                        );
                        arr.put_index(
                            global,
                            0,
                            bun_string_jsc::create_utf8_for_js(global, route_name)?,
                        )?;
                    }
                    n = 1;
                    loop {
                        if let Some(layout) = route.file_layout {
                            let mut buf = paths::path_buffer_pool::get();
                            let layout_name = self.relative_path(
                                &mut buf,
                                &keys[from_opaque_file_id::<{ bake::Side::Server }>(layout).get()
                                    as usize],
                            );
                            arr.put_index(
                                global,
                                u32::try_from(n).expect("int cast"),
                                bun_string_jsc::create_utf8_for_js(global, layout_name)?,
                            )?;
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = self.router.route_ptr(p);
                    }
                    self.framework_bundle_mut(route_bundle_index)
                        .cached_module_list = jsc::StrongOptional::create(arr, global);
                    break 'arr arr;
                }
            },
            // clientId
            client_id: match cached_client_bundle_url {
                Some(s) => s,
                None => 'str: {
                    let bundle_index: u32 = route_bundle_index.get();
                    let generation: u32 = client_script_generation;
                    // Fixed 8-char native-endian byte hex per u32; `on_js_request`
                    // slices exactly 16 chars and decodes via `parse_hex_to_int`.
                    let mut hex = [0u8; 16];
                    bun_core::fmt::bytes_to_hex_lower(&bundle_index.to_ne_bytes(), &mut hex[..8]);
                    bun_core::fmt::bytes_to_hex_lower(&generation.to_ne_bytes(), &mut hex[8..]);
                    let js = BunString::create_format(format_args!(
                        "{CLIENT_PREFIX}/route-{}.js",
                        bstr::BStr::new(&hex),
                    ))
                    .into_js(global)?;
                    self.framework_bundle_mut(route_bundle_index)
                        .cached_client_bundle_url = jsc::StrongOptional::create(js, global);
                    break 'str js;
                }
            },
            // styles
            styles: match cached_css_file_array {
                Some(a) => a,
                None => 'arr: {
                    let js = self.generate_css_js_array(route_bundle_index)?;
                    self.framework_bundle_mut(route_bundle_index)
                        .cached_css_file_array = jsc::StrongOptional::create(js, global);
                    break 'arr js;
                }
            },
            // params
            params: params_js_value,

            // setAsyncLocalStorage
            set_async_local_storage: if first_request {
                Bake__getEnsureAsyncLocalStorageInstanceJSFunction(global)
            } else {
                JSValue::NULL
            },
            bundle_new_route: if first_request {
                Bake__getBundleNewRouteJSFunction(global)
            } else {
                JSValue::NULL
            },
            new_route_params: if first_request {
                Bake__getNewRouteParamsJSFunction(global)
            } else {
                JSValue::NULL
            },
        })
    }

    /// Compute everything the framework's `handleRequest` needs for the route
    /// at `route_bundle_index`; the caller makes the call ([`FrameworkCall::run`]).
    fn prepare_framework_request(
        &mut self,
        route_bundle_index: route_bundle::Index,
        url: &[u8],
    ) -> JsResult<FrameworkCall> {
        debug_assert!(matches!(
            self.route_bundles[route_bundle_index.get() as usize].data,
            route_bundle::Data::Framework(_)
        ));

        // Extract route params by re-matching the URL
        let mut params: framework_router::MatchedParams = Default::default();

        // Extract pathname from URL (remove protocol, host, query, hash)
        let pathname = extract_pathname_from_url(url);

        // Create params JSValue
        // TODO: lazy structure caching since we are making these objects a lot
        let global = self.vm().global();
        let params_js_value = if self.router.match_slow(pathname, &mut params).is_some() {
            params.to_js(global)
        } else {
            JSValue::NULL
        };

        let server_request_callback = self
            .server_fetch_function_callback
            .get()
            .expect("did not initialize server code");

        let args = self.compute_arguments_for_framework_request(
            route_bundle_index,
            params_js_value,
            true,
        )?;

        Ok(FrameworkCall {
            callback: server_request_callback,
            args,
        })
    }

    fn on_html_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        debug_assert!(matches!(
            self.route_bundles[route_bundle_index.get() as usize].data,
            route_bundle::Data::Html(_)
        ));

        let cached: Option<bun_ptr::ThisPtr<StaticRoute>> = self.route_bundles
            [route_bundle_index.get() as usize]
            .data
            .html()
            .cached_response
            .as_ref()
            .map(bun_ptr::RefPtr::this_ptr);
        let blob: bun_ptr::ThisPtr<StaticRoute> = match cached {
            Some(blob) => blob,
            None => 'generate: {
                let payload = self.generate_html_payload(route_bundle_index).expect("oom");

                let response = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::HTML),
                        server: Some(self.server),
                        ..Default::default()
                    },
                );
                let blob = response.this_ptr();
                self.route_bundles[route_bundle_index.get() as usize]
                    .data
                    .html_mut()
                    .cached_response = Some(response);
                break 'generate blob;
            }
        };
        StaticRoute::on_with_method(blob, method, resp);
    }
}

/// This payload is used to unref the source map weak reference if the page
/// starts loading but the JavaScript code is not reached. The event handler
/// is replaced by the HMR runtime to one that handles things better.
const SCRIPT_UNREF_PAYLOAD: &str = concat!(
    "<script>",
    "((a)=>{",
    "document.addEventListener('visibilitychange',",
    "globalThis[Symbol.for('bun:loadData')]=()=>",
    "document.visibilityState==='hidden'&&",
    "navigator.sendBeacon('/_bun/unref',a)",
    ");",
    "})(document.querySelector('[data-bun-dev-server-script]').src.slice(-11,-3))",
    "</script>",
);

impl DevServer {
    fn generate_html_payload(
        &mut self,
        route_bundle_index: route_bundle::Index,
    ) -> crate::Result<Vec<u8>> {
        let (trace_key, client_script_generation, script_injection_offset, bundled_html, html_path) = {
            let route_bundle = &mut self.route_bundles[route_bundle_index.get() as usize];
            debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
            let trace_key = route_bundle.trace_key();
            let generation = route_bundle.client_script_generation;
            let html = route_bundle.data.html_mut();
            debug_assert!(html.html_bundle.dev_server_id.get() == Some(route_bundle_index));
            debug_assert!(html.cached_response.is_none());
            // `report_html_routes_without_html` keeps a route without these out of the loaded state.
            let script_injection_offset = html
                .script_injection_offset
                .expect("loaded html route has no script injection offset")
                .get_usize();
            // Moved out for the duration of this function (put back below) so
            // the graph can be traced while it is read.
            let bundled_html = html
                .bundled_html_text
                .take()
                .expect("loaded html route has no bundled html");
            (
                trace_key,
                generation,
                script_injection_offset,
                bundled_html,
                html.html_bundle.bundle.path.clone(),
            )
        };
        let result = self.generate_html_payload_from(
            route_bundle_index,
            trace_key,
            client_script_generation,
            script_injection_offset,
            &bundled_html,
            &html_path,
        );
        self.route_bundles[route_bundle_index.get() as usize]
            .data
            .html_mut()
            .bundled_html_text = Some(bundled_html);
        result
    }

    fn generate_html_payload_from(
        &mut self,
        route_bundle_index: route_bundle::Index,
        trace_key: route_bundle::TraceKey,
        client_script_generation: u32,
        script_injection_offset: usize,
        bundled_html: &[u8],
        html_path: &[u8],
    ) -> crate::Result<Vec<u8>> {
        // The bundler records an offsets in development mode, splitting the HTML
        // file into two chunks. DevServer is able to insert style/script tags
        // using the information available in IncrementalGraph.
        let before_head_end = &bundled_html[..script_injection_offset];
        let after_head_end = &bundled_html[script_injection_offset..];

        let mut display_name =
            strings::without_suffix_comptime(paths::basename(html_path), b".html");
        // TODO: function for URL safe chars
        if !strings::is_all_ascii(display_name) || strings::contains_char(display_name, b'"') {
            display_name = b"page";
        }

        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets for tracing
        let mut gts = self.init_graph_trace_state(0)?;
        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(trace_key, &mut gts, TraceImportGoal::FindCss)?;

        let css_ids: &[u64] = &self.client_graph.current_css_files;

        let payload_size = bundled_html.len()
            + ("<link rel=\"stylesheet\" href=\"".len()
                + ASSET_PREFIX.len()
                + "/0000000000000000.css\">".len())
                * css_ids.len()
            + "<script type=\"module\" crossorigin src=\"\" data-bun-dev-server-script></script>"
                .len()
            + CLIENT_PREFIX.len()
            + "/".len()
            + display_name.len()
            + "-0000000000000000.js".len()
            + SCRIPT_UNREF_PAYLOAD.len();

        let mut array: Vec<u8> = Vec::with_capacity(payload_size);
        array.extend_from_slice(before_head_end);

        // Insert all link tags before "</head>"
        let mut hex_buf = [0u8; 16];
        for name in css_ids {
            array.extend_from_slice(b"<link rel=\"stylesheet\" href=\"");
            array.extend_from_slice(ASSET_PREFIX.as_bytes());
            array.extend_from_slice(b"/");
            let n = bun_core::fmt::bytes_to_hex_lower(&name.to_ne_bytes(), &mut hex_buf);
            array.extend_from_slice(&hex_buf[..n]);
            array.extend_from_slice(b".css\">");
        }

        array.extend_from_slice(b"<script type=\"module\" crossorigin src=\"");
        array.extend_from_slice(CLIENT_PREFIX.as_bytes());
        array.extend_from_slice(b"/");
        array.extend_from_slice(display_name);
        array.extend_from_slice(b"-");
        let n = bun_core::fmt::bytes_to_hex_lower(
            &(route_bundle_index.get() as u32).to_ne_bytes(),
            &mut hex_buf,
        );
        array.extend_from_slice(&hex_buf[..n]);
        let n = bun_core::fmt::bytes_to_hex_lower(
            &client_script_generation.to_ne_bytes(),
            &mut hex_buf,
        );
        array.extend_from_slice(&hex_buf[..n]);
        array.extend_from_slice(b".js\" data-bun-dev-server-script></script>");
        array.extend_from_slice(SCRIPT_UNREF_PAYLOAD.as_bytes());

        // DevServer used to put the script tag before the body end, but to match the regular bundler it does not do this.
        array.extend_from_slice(after_head_end);
        debug_assert!(array.len() == array.capacity()); // incorrect memory allocation size
        Ok(array)
    }

    fn generate_javascript_code_for_html_file(
        &mut self,
        index: bun_ast::Index,
        import_records: &[bun_ast::import_record::List<'_>],
        input_file_sources: &[bun_ast::Source],
        loaders: &[Loader],
    ) -> crate::Result<Box<[u8]>> {
        let mut array: Vec<u8> = Vec::with_capacity(65536);
        let w = &mut array;

        w.extend_from_slice(b"  ");
        bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
            input_file_sources[index.get() as usize].path.pretty,
            w,
        )?;
        w.extend_from_slice(b": [ [");
        let mut any = false;
        for import in import_records[index.get() as usize].as_slice() {
            if import.source_index.is_valid() {
                if !loaders[import.source_index.get() as usize].is_javascript_like() {
                    continue; // ignore non-JavaScript imports
                }
            } else {
                // Find the in-graph import.
                let Some(file) = self.client_graph.bundled_files.get(import.path.text) else {
                    continue;
                };
                if !matches!(file.content, incremental_graph::Content::Js(_)) {
                    continue;
                }
            }
            if !any {
                any = true;
                w.extend_from_slice(b"\n");
            }
            w.extend_from_slice(b"    ");
            bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                import.path.pretty,
                w,
            )?;
            w.extend_from_slice(b", 0,\n");
        }
        if any {
            w.extend_from_slice(b"  ");
        }
        w.extend_from_slice(b"], [], [], () => {}, false],\n");

        // Avoid-recloning if it is was moved to the heap
        Ok(array.into_boxed_slice())
    }

    pub(crate) fn on_js_request_with_bundle(
        &mut self,
        bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        let cached: Option<bun_ptr::ThisPtr<StaticRoute>> = self
            .route_bundle_ptr(bundle_index)
            .client_bundle
            .as_ref()
            .map(bun_ptr::RefPtr::this_ptr);
        let client_bundle: bun_ptr::ThisPtr<StaticRoute> = match cached {
            Some(client_bundle) => client_bundle,
            None => 'generate: {
                let payload = self.generate_client_bundle(bundle_index).expect("oom");
                let bundle = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::JAVASCRIPT),
                        server: Some(self.server),
                        ..Default::default()
                    },
                );
                let client_bundle = bundle.this_ptr();
                self.route_bundle_ptr(bundle_index).client_bundle = Some(bundle);
                break 'generate client_bundle;
            }
        };
        let source_map_id = self.route_bundle_ptr(bundle_index).source_map_id();
        self.source_maps.add_weak_ref(source_map_id);
        StaticRoute::on_with_method(client_bundle, method, resp);
    }
}

enum DevResponse<'a> {
    Http(AnyResponse),
    Promise(PromiseResponse<'a>),
}

/// When requests are waiting on a bundle, the relevant request information is
/// prepared and stored in a `DeferredRequest`. Ref holders: the bundle's
/// request list (`CurrentBundle.requests` / `NextBundle.requests`) until the
/// dev server answers it, and — for `Handler::ServerHandler` — the request
/// context's `AdditionalOnAbortCallback` until the request aborts or finishes.
#[derive(bun_ptr::CellRefCounted)]
pub struct DeferredRequest {
    ref_count: Cell<u32>,
    pub(crate) route_bundle_index: route_bundle::Index,
    pub(crate) handler: JsCell<Handler>,
    /// Set once the dev server has answered (or dropped) this request; an
    /// abort arriving afterwards is ignored.
    handled: Cell<bool>,
}

pub mod deferred_request {
    use super::*;

    pub type List = Vec<bun_ptr::RefPtr<DeferredRequest>>;

    bun_output::define_scoped_log!(debug_log_dr, DlogeferredRequest, hidden);
    pub(super) use debug_log_dr;

    /// Sometimes we will call `await bundleNewRoute()` and this will either
    /// resolve with the args for the route, or reject with data
    pub struct PromiseResponse<'a> {
        pub(crate) promise: jsc::JSPromiseStrong,
        pub global: &'a JSGlobalObject,
    }

    pub enum Handler {
        /// For a .framework route. This says to call and render the page.
        ServerHandler(SavedRequest),
        /// For a .html route. Serve the bundled HTML page.
        BundledHtmlPage(ResponseAndMethod),
        /// Do nothing and free this node. To simplify lifetimes,
        /// the `DeferredRequest` is not freed upon abortion. Which
        /// is okay since most requests do not abort.
        Aborted,
    }

    /// Does not include `aborted` because branching on that value
    /// has no meaningful purpose, so it is excluded.
    #[derive(Copy, Clone)]
    pub enum HandlerKind {
        ServerHandler,
        BundledHtmlPage,
    }
}
use deferred_request::{DlogeferredRequest, Handler, PromiseResponse};

// LAYERING: `SavedRequestUnion` was a local mirror because `server_body`'s
// copy was unnameable; the canonical enum now lives in `crate::server` so
// `AnyServer::on_saved_request` can name it across the seam.
pub(super) use crate::server::SavedRequestUnion;

impl DeferredRequest {
    /// Release the request list's ref: the dev server is done with this
    /// request, so tear down whatever the handler still holds first.
    #[allow(clippy::needless_pass_by_value)] // consumes the list's ref
    pub(crate) fn release(this: bun_ptr::RefPtr<DeferredRequest>) {
        this.retire();
        drop(this);
    }

    fn retire(&self) {
        self.handled.set(true);
        deferred_request::debug_log_dr!(
            "DeferredRequest(0x{:x}) deinitImpl",
            std::ptr::from_ref(self) as usize
        );
        if let Handler::ServerHandler(mut saved) = self.handler.replace(Handler::Aborted) {
            saved.deinit();
            // `saved` (incl. `js_request: jsc::Strong`) drops at scope exit.
        }
    }

    /// The request context this was deferred for aborted.
    pub(crate) fn on_abort_from_request_context(&self) {
        if self.handled.get() {
            return;
        }
        self.on_abort();
    }

    fn on_abort(&self) {
        deferred_request::debug_log_dr!(
            "DeferredRequest(0x{:x}) onAbort",
            std::ptr::from_ref(self) as usize
        );
        self.abort();
        debug_assert!(matches!(*self.handler.get(), Handler::Aborted));
    }

    /// Deinitializes state by aborting the connection.
    pub(crate) fn abort(&self) {
        deferred_request::debug_log_dr!(
            "DeferredRequest(0x{:x}) abort",
            std::ptr::from_ref(self) as usize
        );
        match self.handler.replace(Handler::Aborted) {
            Handler::ServerHandler(saved) => {
                deferred_request::debug_log_dr!(
                    "  request url: {}",
                    bstr::BStr::new(
                        saved
                            .request()
                            .map_or(&b""[..], |r| r.url.get().byte_slice())
                    )
                );
                saved
                    .ctx
                    .set_signal_aborted(jsc::CommonAbortReason::ConnectionClosed);
                // Note: saved.js_request (jsc::Strong) drops at end of arm
                drop(saved);
            }
            Handler::BundledHtmlPage(r) => {
                // Reached from JS event-loop tasks (on_plugins_rejected, the
                // bundle-completion OOM cleanup defer), so end_without_body
                // alone cannot close the socket; write Content-Length so the
                // client has framing.
                r.response.write_status(b"500 Internal Server Error");
                r.response.write_header_int(b"Content-Length", 0);
                r.response.end_without_body(true);
            }
            Handler::Aborted => {}
        }
    }
}

#[derive(Copy, Clone)]
pub struct ResponseAndMethod {
    pub response: AnyResponse,
    pub method: Method,
}

impl DevServer {
    /// Start bundling `request.entry_points`. The bundler's entry-point setup
    /// can run plugin (`onResolve`) JavaScript, so it runs between — not
    /// inside — the dev server borrows.
    pub(crate) fn start_async_bundle(
        cell: &DevServerCell,
        request: BundleRequest,
    ) -> crate::Result<()> {
        let BundleRequest {
            entry_points,
            had_reload_event,
            timer,
        } = request;
        // Bound in this order so that on an early return `bv2` (which borrows
        // `*heap`) drops before `heap`.
        let BundleSetup {
            heap,
            ast_memory_store,
            mut bv2,
        } = cell.with_mut(|dev| dev.start_async_bundle_setup(&entry_points))?;

        // AST nodes built while the entry points are enqueued live exactly as
        // long as the bundle: the `AstAllocState` is taken into `CurrentBundle`
        // below and released by the guard on every path.
        let mut ast_memory_store =
            scopeguard::guard(ast_memory_store, |store| store.release_ast_state());
        let ast_scope = ast_memory_store.enter();

        // LAYERING: `bun_bundler::bake_types::EntryPointList` is the TYPE_ONLY
        // mirror of this file's `EntryPointList` (moved down so `bun_bundler`
        // can name it without depending on `bun_runtime`). Convert by value —
        // both `Flags` are `#[repr(transparent)] u8` with identical bit layout.
        let started = bv2.start_from_bake_dev_server(&{
            let mut bt = bundler::bake_types::EntryPointList::empty();
            for (k, v) in entry_points.set.iter() {
                bun_core::handle_oom(
                    bt.set
                        .put(k, bundler::bake_types::EntryPointFlags(v.bits())),
                );
            }
            bt
        });
        drop(entry_points);

        let start_data = cell.with_mut(|dev| -> crate::Result<_> {
            let (start_data, resolve_failures) = started?;
            for failure in resolve_failures {
                dev.handle_parse_task_failure(
                    &crate::Error::from(failure.err),
                    failure.graph,
                    &failure.abs_path,
                    &failure.log,
                    &mut bv2,
                )?;
            }
            Ok(start_data)
        })?;
        // End the AST scope and move its state into the bundle so the small
        // `AstVec`s built during setup stay alive until the bundle completes.
        drop(ast_scope);
        let ast_alloc_state = ast_memory_store.take_ast_state();
        drop(ast_memory_store);

        cell.with_mut(move |dev| {
            dev.current_bundle = Some(CurrentBundle {
                bv2,
                heap,
                ast_alloc_state,
                timer,
                start_data,
                had_reload_event,
                requests: ::core::mem::take(&mut dev.next_bundle.requests),
                promise: ::core::mem::take(&mut dev.next_bundle.promise),
                resolution_failure_entries: Default::default(),
            });

            dev.next_bundle.promise = DeferredPromise::default();
            dev.next_bundle.requests = deferred_request::List::default();
            dev.next_bundle.route_queue.clear_retaining_capacity();
        });
        Ok(())
    }

    /// Everything `start_async_bundle` does before handing the entry points
    /// to the bundler.
    fn start_async_bundle_setup(
        &mut self,
        entry_points: &EntryPointList,
    ) -> crate::Result<BundleSetup> {
        debug_assert!(self.current_bundle.is_none());
        debug_assert!(!entry_points.set.is_empty());
        self.log.clear_and_free();

        // Notify inspector about bundle start
        if let Some(agent) = self.inspector() {
            let mut trigger_files: Vec<BunString> = Vec::with_capacity(entry_points.set.len());
            for key in entry_points.set.keys() {
                trigger_files.push(BunString::clone_utf8(key));
            }
            agent.notify_bundle_start(self.inspector_server_id, &trigger_files);
        }

        self.incremental_result.reset();

        // Ref server to keep it from closing.
        self.server.on_pending_request();

        // Owned by the `CurrentBundle` alongside `bv2`, which borrows it as
        // `graph.heap`.
        let heap: Box<bun_alloc::MimallocArena> = Box::new(bun_alloc::MimallocArena::new());
        let (server_transpiler, heap_ref) = self.bundle_borrows(&heap);
        let client_transpiler = ::core::ptr::NonNull::from(&mut *self.client_transpiler);
        let ssr_transpiler = match &mut self.ssr_transpiler {
            Some(t) => ::core::ptr::NonNull::from(&mut **t),
            None => ::core::ptr::NonNull::from(&mut *server_transpiler),
        };

        let ast_memory_store = heap_ref.alloc(bun_ast::ASTMemoryAllocator::borrowing(heap_ref));

        // The bundler stores `Option<NonNull<AnyEventLoop>>`; park the value
        // in `heap` so it lives exactly as long as `bv2`.
        let event_loop: bun_bundler::linker_context_mod::EventLoop =
            Some(::core::ptr::NonNull::from(heap_ref.alloc(
                bun_event_loop::AnyEventLoop::js(self.vm().event_loop().cast()),
            )));

        let mut bv2: Box<BundleV2<'static>> = BundleV2::init(
            server_transpiler,
            Some(bundler::bundle_v2::BakeOptions {
                framework: self.framework.as_bundler_view(),
                client_transpiler,
                ssr_transpiler,
                plugins: self.bundler_options.plugin,
            }),
            heap_ref,
            event_loop,
            false, // watching is handled separately
            Some(::core::ptr::NonNull::from(
                bun_threading::work_pool::WorkPool::get(),
            )),
            heap_ref,
        )?;
        bv2.bun_watcher = Some(::core::ptr::NonNull::from(self.watcher()));
        bv2.asynchronous = true;
        let dev_handle = self.bundler_handle();
        bv2.dev_server = Some(dev_handle);
        bv2.linker.dev_server = Some(dev_handle);

        {
            self.graph_safety_lock.lock();
            self.client_graph.reset();
            self.server_graph.reset();
            self.graph_safety_lock.unlock();
        }

        Ok(BundleSetup {
            bv2,
            ast_memory_store,
            heap,
        })
    }

    /// The two borrows a `BundleV2<'static>` holds for the lifetime of a
    /// bundle: the server transpiler (`bv2.transpiler`) and the bundle's heap
    /// (`bv2.graph.heap`). `BundleV2<'a>` ties both to one `'a`, which for the
    /// dev server's `Transpiler<'static>` must be `'static`. Liveness: the
    /// transpiler is boxed in `self` and the heap is boxed in the
    /// `CurrentBundle` next to `bv2`, and `finalize_bundle_cleanup` drops `bv2`
    /// before either. Aliasing: this is NOT exclusive — the dev server keeps
    /// using `self.server_transpiler` (its resolver) while the bundle runs, as
    /// the bundler's own `client_transpiler`/`ssr_transpiler` `NonNull`s
    /// already do. Goes away when `BundleV2` takes its primary transpiler the
    /// same way (`NonNull`/`BackRef`) and owns the dev-server bundle heap.
    fn bundle_borrows(
        &mut self,
        heap: &bun_alloc::MimallocArena,
    ) -> (
        &'static mut Transpiler<'static>,
        &'static bun_alloc::MimallocArena,
    ) {
        // SAFETY: see doc comment (liveness holds; exclusivity is the bundler's
        // existing shared-transpiler contract, not established here).
        unsafe {
            (
                bun_ptr::detach_lifetime_mut(&mut *self.server_transpiler),
                bun_ptr::detach_lifetime_ref(heap),
            )
        }
    }

    pub(crate) fn prepare_and_log_resolution_failures(&mut self) -> crate::Result<()> {
        // Since resolution failures can be asynchronous, their logs are not inserted
        // until the very end.
        let resolution_failures = ::core::mem::take(
            &mut self
                .current_bundle
                .as_mut()
                .expect("infallible: bundle active")
                .resolution_failure_entries,
        );
        let mut inserted = Ok(());
        for (owner, log) in resolution_failures
            .keys()
            .iter()
            .zip(resolution_failures.values())
        {
            if log.has_errors() {
                // `resolution_failure_entries` keys are `OwnerPacked` (1-bit side + file).
                let index = owner.file();
                inserted = match owner.side() {
                    bake::Side::Client => self.client_graph_mut().insert_failure(
                        incremental_graph::InsertFailureKey::Index(index),
                        log,
                        false,
                    ),
                    bake::Side::Server => self.server_graph_mut().insert_failure(
                        incremental_graph::InsertFailureKey::Index(index),
                        log,
                        true,
                    ),
                };
                if inserted.is_err() {
                    break;
                }
            }
        }
        self.current_bundle
            .as_mut()
            .expect("infallible: bundle active")
            .resolution_failure_entries = resolution_failures;
        inserted?;

        // Theoretically, it shouldn't be possible for errors to leak into dev.log
        if self.log.has_errors() && !self.log.msgs.is_empty() {
            if cfg!(debug_assertions) {
                bun_core::debug_warn!("dev.log should not be written into when using DevServer");
            }
            let _ = self.log.print(std::ptr::from_mut(Output::error_writer()));
        }
        Ok(())
    }

    /// A route that a bundle left without html must not reach the loaded state: fail its file instead.
    fn report_html_routes_without_html(&mut self) -> crate::Result<()> {
        for i in 0..self.route_bundles.len() {
            let route_bundle = &self.route_bundles[i];
            let route_bundle::Data::Html(html) = &route_bundle.data else {
                continue;
            };
            if html.bundled_html_text.is_some() {
                continue;
            }
            let file_index = html.bundled_file;
            let failed_in_this_bundle = |failure: &SerializedFailure| {
                matches!(
                    failure.get_owner(),
                    serialized_failure::Owner::Client(owner) if owner == file_index
                )
            };
            let has_failure = match route_bundle.server_state {
                route_bundle::State::Unqueued | route_bundle::State::DeferredToNextBundle => {
                    continue;
                }
                // `finalize_bundle` answers this bundle's requests from the failures it added: re-add an older one.
                route_bundle::State::Bundling => self
                    .incremental_result
                    .failures_added
                    .iter()
                    .any(failed_in_this_bundle),
                // An earlier failure still gates the route, unless this bundle cleared it without delivering html.
                route_bundle::State::PossibleBundlingFailures | route_bundle::State::Loaded => {
                    self.client_graph.bundled_files.values()[file_index.get() as usize].failed
                }
            };
            if has_failure {
                continue;
            }

            let log = html.html_bundle.bundle.no_html_page_log();
            self.client_graph_mut().insert_failure(
                incremental_graph::InsertFailureKey::Index(file_index.get()),
                &log,
                false,
            )?;
        }
        Ok(())
    }

    fn index_failures(&mut self) -> crate::Result<()> {
        // After inserting failures into the IncrementalGraphs, they are traced to their routes.

        if !self.incremental_result.failures_added.is_empty() {
            let mut total_len: usize =
                ::core::mem::size_of::<MessageId>() + ::core::mem::size_of::<u32>();

            for fail in &self.incremental_result.failures_added {
                total_len += fail.data.len();
            }

            total_len +=
                self.incremental_result.failures_removed.len() * ::core::mem::size_of::<u32>();

            let mut gts = self.init_graph_trace_state(0)?;

            let mut payload: Vec<u8> = Vec::with_capacity(total_len);
            payload.push(MessageId::Errors.char());

            payload.extend_from_slice(
                &u32::try_from(self.incremental_result.failures_removed.len())
                    .unwrap()
                    .to_le_bytes(),
            );

            for removed in &self.incremental_result.failures_removed {
                payload.extend_from_slice(&removed.get_owner().encode().bits().to_le_bytes());
                removed.deinit(self);
            }

            let mut owners = Vec::with_capacity(self.incremental_result.failures_added.len());
            for added in &self.incremental_result.failures_added {
                payload.extend_from_slice(&added.data);
                owners.push(added.get_owner());
            }
            for owner in owners {
                match owner {
                    serialized_failure::Owner::None | serialized_failure::Owner::Route(_) => {
                        unreachable!()
                    }
                    serialized_failure::Owner::Server(index) => {
                        self.server_graph_mut().trace_dependencies(
                            index,
                            &mut gts,
                            incremental_graph::TraceDependencyGoal::NoStop,
                            index,
                        )?
                    }
                    serialized_failure::Owner::Client(index) => {
                        self.client_graph_mut().trace_dependencies(
                            index,
                            &mut gts,
                            incremental_graph::TraceDependencyGoal::NoStop,
                            index,
                        )?
                    }
                }
            }

            // Note: iterate by index — the loop bodies need
            // `&mut self.route_bundles` / `&mut self.router`, which conflicts
            // with the `&self.incremental_result` iterator borrow.
            for i in 0..self.incremental_result.framework_routes_affected.len() {
                let entry = self.incremental_result.framework_routes_affected[i];
                if let Some(index) = self.router.route_ptr(entry.route_index()).bundle {
                    self.route_bundle_ptr(index).server_state =
                        route_bundle::State::PossibleBundlingFailures;
                }
                if entry.should_recurse_when_visiting() {
                    self.mark_all_route_children_failed(entry.route_index());
                }
            }

            for i in 0..self.incremental_result.html_routes_soft_affected.len() {
                let index = self.incremental_result.html_routes_soft_affected[i];
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }

            for i in 0..self.incremental_result.html_routes_hard_affected.len() {
                let index = self.incremental_result.html_routes_hard_affected[i];
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::BINARY);
        } else if !self.incremental_result.failures_removed.is_empty() {
            let mut payload: Vec<u8> = Vec::with_capacity(
                ::core::mem::size_of::<MessageId>()
                    + ::core::mem::size_of::<u32>()
                    + self.incremental_result.failures_removed.len()
                        * ::core::mem::size_of::<u32>(),
            );
            payload.push(MessageId::Errors.char());

            payload.extend_from_slice(
                &u32::try_from(self.incremental_result.failures_removed.len())
                    .unwrap()
                    .to_le_bytes(),
            );

            for removed in &self.incremental_result.failures_removed {
                payload.extend_from_slice(&removed.get_owner().encode().bits().to_le_bytes());
                removed.deinit(self);
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::BINARY);
        }

        self.incremental_result.failures_removed.clear();
        Ok(())
    }

    /// Used to generate the entry point. Unlike incremental patches, this always
    /// contains all needed files for a route.
    fn generate_client_bundle(&mut self, rbi: route_bundle::Index) -> crate::Result<Vec<u8>> {
        let (trace_key, script_id) = {
            let route_bundle = &self.route_bundles[rbi.get() as usize];
            debug_assert!(route_bundle.client_bundle.is_none());
            debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
            (route_bundle.trace_key(), route_bundle.source_map_id())
        };

        let _lock = self.graph_safety_lock.guard();
        // `current_chunk_parts`/`current_chunk_len` are scratch buffers shared with
        // the HMR pipeline. We must leave them cleared on every exit path.
        let mut this = scopeguard::guard(&mut *self, |dev| dev.client_graph.reset());
        let dev = &mut **this;

        // Prepare bitsets
        let mut gts = dev.init_graph_trace_state(0)?;

        // Run tracing
        dev.client_graph.reset();
        dev.trace_all_route_imports(trace_key, &mut gts, TraceImportGoal::FindClientModules)?;

        let mut react_fast_refresh_id: Vec<u8> = Vec::new();
        if let Some(import_source) = dev
            .framework
            .react_fast_refresh
            .as_ref()
            .map(|rfr| rfr.import_source.to_vec())
        {
            'brk: {
                let Some(rfr_index) = dev.client_graph.get_file_index(&import_source) else {
                    break 'brk;
                };
                if !dev
                    .client_graph
                    .stale_files
                    .is_set(rfr_index.get() as usize)
                {
                    dev.client_graph_mut().trace_imports(
                        rfr_index,
                        &mut gts,
                        TraceImportGoal::FindClientModules,
                    )?;
                    react_fast_refresh_id = import_source;
                }
            }
        }

        let client_file: Option<incremental_graph::ClientFileIndex> = match trace_key {
            route_bundle::TraceKey::Framework(route_index) => {
                let type_idx = dev.router.route_ptr(route_index).r#type;
                dev.router
                    .type_ptr(type_idx)
                    .client_file
                    .map(from_opaque_file_id::<{ bake::Side::Client }>)
            }
            route_bundle::TraceKey::Html(bundled_file) => Some(bundled_file),
        };

        // Insert the source map
        map_log!("inc {:x}, 1 for generateClientBundle", script_id.get());
        match dev.source_maps.put_or_increment_ref_count(script_id, 1)? {
            source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => {
                gts.clear_and_free();
                let filled = dev.client_graph.take_source_map(entry);
                if filled.is_err() {
                    dev.source_maps.unref(script_id);
                }
                filled?;
            }
            source_map_store::PutOrIncrementRefCount::Shared(_) => {}
        }

        // `take_js_bundle` mutably borrows `client_graph` while `initial_entry`
        // would alias `client_graph.bundled_files.keys()[idx]`. Clone the key
        // (a short path string) so the borrow ends before the `&mut client_graph`
        // call; cold path (per-route bundle finalize).
        let initial_entry: Vec<u8> = if let Some(idx) = client_file {
            dev.client_graph.bundled_files.keys()[idx.get() as usize].to_vec()
        } else {
            Vec::new()
        };
        let console_log = dev.should_receive_console_log_from_browser();
        let client_bundle = dev.client_graph_mut().take_js_bundle(
            &incremental_graph::TakeJSBundleOptionsClient {
                kind: crate::bake::dev_server::ChunkKind::InitialResponse,
                initial_response_entry_point: &initial_entry,
                react_refresh_entry_point: &react_fast_refresh_id,
                script_id,
                console_log,
            },
        )?;
        Ok(client_bundle)
    }

    fn generate_css_js_array(&mut self, rbi: route_bundle::Index) -> JsResult<JSValue> {
        let trace_key = {
            let route_bundle = &self.route_bundles[rbi.get() as usize];
            debug_assert!(matches!(
                route_bundle.data,
                route_bundle::Data::Framework(_)
            ));
            debug_assert!(!route_bundle.data.framework().cached_css_file_array.has());
            debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
            route_bundle.trace_key()
        };

        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(trace_key, &mut gts, TraceImportGoal::FindCss)?;

        let names: &[u64] = &self.client_graph.current_css_files;
        let global = self.vm().global();
        let arr = jsc::JSArray::create_empty(global, names.len())?;
        for (i, item) in names.iter().enumerate() {
            let mut buf =
                [0u8; ASSET_PREFIX.len() + ::core::mem::size_of::<u64>() * 2 + "/.css".len()];
            let buf_len = buf.len();
            let path = {
                let mut cursor = &mut buf[..];
                write!(
                    cursor,
                    "{}/{}.css",
                    ASSET_PREFIX,
                    bstr::BStr::new(
                        bun_core::fmt::bytes_to_hex_lower_string(&item.to_ne_bytes()).as_bytes()
                    ),
                )
                .expect("unreachable");
                let written = buf_len - cursor.len();
                &buf[..written]
            };
            arr.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                bun_string_jsc::create_utf8_for_js(global, path)?,
            )?;
        }
        Ok(arr)
    }

    fn trace_all_route_imports(
        &mut self,
        route_bundle: route_bundle::TraceKey,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> crate::Result<()> {
        match route_bundle {
            route_bundle::TraceKey::Framework(route_index) => {
                let route_fields = |router: &FrameworkRouter, i: framework_router::RouteIndex| {
                    let r = router.route_ptr(i);
                    (r.r#type, r.file_page, r.file_layout, r.parent)
                };
                let (route_type, file_page, mut file_layout, mut parent) =
                    route_fields(&self.router, route_index);
                let (rt_server_file, rt_client_file) = {
                    let rt = self.router.type_ptr_const(route_type);
                    (rt.server_file, rt.client_file)
                };

                // Both framework entry points are considered
                self.server_graph_mut().trace_imports(
                    from_opaque_file_id::<{ bake::Side::Server }>(rt_server_file),
                    gts,
                    TraceImportGoal::FindCss,
                )?;
                if let Some(id) = rt_client_file {
                    self.client_graph_mut().trace_imports(
                        from_opaque_file_id::<{ bake::Side::Client }>(id),
                        gts,
                        goal,
                    )?;
                }

                // The route file is considered
                if let Some(id) = file_page {
                    self.server_graph_mut().trace_imports(
                        from_opaque_file_id::<{ bake::Side::Server }>(id),
                        gts,
                        goal,
                    )?;
                }

                // For all parents, the layout is considered
                loop {
                    if let Some(id) = file_layout {
                        self.server_graph_mut().trace_imports(
                            from_opaque_file_id::<{ bake::Side::Server }>(id),
                            gts,
                            goal,
                        )?;
                    }
                    let Some(p) = parent else { break };
                    (_, _, file_layout, parent) = route_fields(&self.router, p);
                }
            }
            route_bundle::TraceKey::Html(bundled_file) => {
                self.client_graph_mut()
                    .trace_imports(bundled_file, gts, goal)?;
            }
        }
        Ok(())
    }

    fn make_array_for_server_components_patch(
        &self,
        global: &JSGlobalObject,
        items: &[incremental_graph::ServerFileIndex],
    ) -> JsResult<JSValue> {
        if items.is_empty() {
            return Ok(JSValue::NULL);
        }
        let arr = jsc::JSArray::create_empty(global, items.len())?;
        let names = self.server_graph.bundled_files.keys();
        for (i, item) in items.iter().enumerate() {
            let mut buf = paths::path_buffer_pool::get();
            let s = self.relative_path(&mut *buf, &names[item.get() as usize]);
            arr.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                bun_string_jsc::create_utf8_for_js(global, s)?,
            )?;
        }
        Ok(arr)
    }
}

pub(crate) struct HotUpdateContext<'a> {
    /// bundle_v2.Graph.input_files.items(.source)
    pub sources: &'a [bun_ast::Source],
    /// bundle_v2.Graph.ast.items(.import_records)
    pub import_records: &'a [bun_ast::import_record::List<'a>],
    /// bundle_v2.Graph.input_files.items(.loader)
    pub loaders: &'a [Loader],
    /// Which files have a server-component boundary.
    pub server_to_client_bitset: DynamicBitSet,
    /// Used to reduce calls to the IncrementalGraph hash table.
    /// First half is for client graph, second half for server.
    pub resolved_index_cache: &'a mut [CachedFileIndex],
    /// Used to tell if the server should replace or append import records.
    pub server_seen_bit_set: DynamicBitSet,
    pub gts: &'a mut GraphTraceState,
}

/// Sentinel-encoded `Option<FileIndex>` packed into a `u32` (`u32::MAX` == none).
/// Side-erased so the `resolved_index_cache` backing slice stores it directly;
/// callers re-tag with the correct `FileIndex<SIDE>` on `unwrap`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) struct CachedFileIndex(pub u32);
impl CachedFileIndex {
    pub(crate) const NONE: Self = Self(u32::MAX);
    #[inline]
    pub(crate) fn unwrap<const SIDE: bake::Side>(
        self,
    ) -> Option<incremental_graph::FileIndex<SIDE>> {
        if self.0 == u32::MAX {
            None
        } else {
            Some(incremental_graph::FileIndex::<SIDE>::init(self.0))
        }
    }
}
impl<const SIDE: bake::Side> From<Option<incremental_graph::FileIndex<SIDE>>> for CachedFileIndex {
    fn from(v: Option<incremental_graph::FileIndex<SIDE>>) -> Self {
        match v {
            Some(i) => Self(i.get()),
            None => Self::NONE,
        }
    }
}

impl<'a> HotUpdateContext<'a> {
    pub(crate) fn get_cached_index(
        &mut self,
        side: bake::Side,
        i: impl Into<bun_ast::Index>,
    ) -> &mut CachedFileIndex {
        let i: bun_ast::Index = i.into();
        let len = self.sources.len();
        let start = match side {
            bake::Side::Client => 0,
            bake::Side::Server => len,
        };

        &mut self.resolved_index_cache[start..][..len][i.get() as usize]
    }
}

fn finalize_bundle_cleanup(
    dev: &mut DevServer,
    bv2: &mut BundleV2,
    had_sent_hmr_event: bool,
) -> Option<BundleRequest> {
    bv2.deinit_without_freeing_arena();
    if let Some(cb) = &mut dev.current_bundle {
        cb.promise.deinit_idempotently();
    }
    // Drops `CurrentBundle.heap` (the arena `bv2.graph.heap` borrows).
    dev.current_bundle = None;
    dev.log.clear_and_free();

    let _ = dev.assets.reindex_if_needed(); // not fatal

    // Signal for testing framework where it is in synchronization
    if matches!(
        dev.testing_batch_events,
        TestingBatchEvents::EnableAfterBundle
    ) {
        dev.testing_batch_events = TestingBatchEvents::Enabled(TestingBatch::empty());
        dev.publish(
            HmrTopic::TestingWatchSynchronization,
            &[MessageId::TestingWatchSynchronization.char(), 0],
            Opcode::BINARY,
        );
    } else {
        dev.publish(
            HmrTopic::TestingWatchSynchronization,
            &[
                MessageId::TestingWatchSynchronization.char(),
                if had_sent_hmr_event { 4 } else { 3 },
            ],
            Opcode::BINARY,
        );
    }

    dev.start_next_bundle_if_present()
}

/// Called at the end of BundleV2 to index bundle contents into the
/// `IncrementalGraph`s. This function does not recover DevServer state if it
/// fails (allocation failure).
///
/// Everything that runs JavaScript (loading the server patch, the framework's
/// request handler, aborted requests' signal handlers, microtasks) runs
/// between — never inside — the `cell.with_mut` sections.
pub(crate) fn finalize_bundle(
    cell: &DevServerCell,
    bv2: &mut BundleV2,
    result: &mut bundler::bundle_v2::DevServerOutput,
) -> JsResult<()> {
    debug_assert!(cell.get().magic == Magic::Valid);
    let vm = cell.get().vm;
    // Promise reactions queued below run when this scope exits, after the
    // last dev server borrow.
    let event_loop_scope = vm.enter_event_loop_scope();
    let mut had_sent_hmr_event = false;
    let finalized = finalize_bundle_phases(cell, bv2, result, &mut had_sent_hmr_event);
    // The chunks live in the bundle's arena, which does not run their destructors.
    for chunk in result.chunks.iter_mut() {
        drop(::core::mem::take(chunk));
    }
    let unanswered = cell.with_mut(|dev| {
        ::core::mem::take(
            &mut dev
                .current_bundle
                .as_mut()
                .expect("infallible: bundle active")
                .requests,
        )
    });
    abort_unanswered_requests(unanswered);
    let next_bundle = cell.with_mut(|dev| finalize_bundle_cleanup(dev, bv2, had_sent_hmr_event));
    let server = cell.get().server;
    if let Some(next_bundle) = next_bundle {
        DevServer::start_async_bundle(cell, next_bundle).expect("oom");
    }
    // Unref the ref added in `start_async_bundle`
    server.on_static_request_complete();
    drop(event_loop_scope);
    finalized
}

/// The server-side HMR patch a bundle produced, loaded into the server
/// runtime between the two graph phases of `finalize_bundle`.
struct ServerPatch {
    code: Vec<u8>,
    source_map_json: Option<Vec<u8>>,
    register_update: JSValue,
    client_components_added: JSValue,
    client_components_removed: JSValue,
}

impl ServerPatch {
    fn load(self, global: &JSGlobalObject) {
        let server_modules = if let Some(json) = self.source_map_json {
            // This memory will be owned by the `DevServerSourceProvider` in C++
            match c::bake_load_server_hmr_patch_with_source_map(
                global,
                BunString::clone_utf8(&self.code),
                json.into_boxed_slice(),
            ) {
                Ok(v) => v,
                Err(err) => {
                    VirtualMachine::get_mut()
                        .print_error_like_object_to_console(global.take_exception(err));
                    // Note: `panic!()` would unwind through the
                    // `extern "C"` boundary above (`nounwind` UB), so abort.
                    bun_core::Output::panic(format_args!(
                        "Error thrown while evaluating server code. This is always a bug in the bundler."
                    ));
                }
            }
        } else {
            match c::bake_load_server_hmr_patch(global, BunString::clone_latin1(&self.code)) {
                Ok(v) => v,
                Err(err) => {
                    VirtualMachine::get_mut()
                        .print_error_like_object_to_console(global.take_exception(err));
                    // Note: `panic!()` would unwind through the
                    // `extern "C"` boundary above (`nounwind` UB), so abort.
                    bun_core::Output::panic(format_args!(
                        "Error thrown while evaluating server code. This is always a bug in the bundler."
                    ));
                }
            }
        };
        let errors = match self.register_update.call(
            global,
            global.to_js_value(),
            &[
                server_modules,
                self.client_components_added,
                self.client_components_removed,
            ],
        ) {
            Ok(v) => v,
            Err(err) => {
                VirtualMachine::get_mut()
                    .print_error_like_object_to_console(global.take_exception(err));
                panic!(
                    "Error thrown in Hot-module-replacement code. This is always a bug in the HMR runtime."
                );
            }
        };
        let _ = errors; // TODO:
    }
}

/// What `finalize_bundle` does with the requests waiting on the bundle.
enum BundleOutcome {
    /// The bundle has failures; everything waiting was answered with the
    /// error page. These request contexts are to be released.
    Failed(Vec<crate::server::AnyRequestContext>),
    /// The bundle is good; serve the waiting requests.
    Serve,
}

/// Releases the deferred requests a bundle never answered (only non-empty
/// when finalizing bailed out early).
fn abort_unanswered_requests(requests: deferred_request::List) {
    if !requests.is_empty() {
        // cannot be an assertion because in the case of OOM, the request list was not drained.
        bun_core::debug!(
            "current_bundle.requests.first != null. this leaves pending requests without an error page!",
        );
    }
    for req in requests.into_iter().rev() {
        req.abort();
        DeferredRequest::release(req);
    }
}

fn finalize_bundle_phases(
    cell: &DevServerCell,
    bv2: &mut BundleV2,
    result: &mut bundler::bundle_v2::DevServerOutput,
    had_sent_hmr_event: &mut bool,
) -> JsResult<()> {
    let bv2: &BundleV2 = bv2;
    // The three regions of `result.chunks` are disjoint:
    // `[0] | [1..1+n_css] | [1+n_css..1+n_css+n_html]`.
    let n_css = result.css_file_list.count();
    let n_html = result.html_files.count();
    let input_file_sources = bv2.graph.input_files.items_source();
    let input_file_loaders = bv2.graph.input_files.items_loader();
    let import_records = bv2.graph.ast.items_import_records();
    let targets = bv2.graph.ast.items_target();
    let scbs = bv2.graph.server_component_boundaries.slice();

    let mut scb_bitset = DynamicBitSet::init_empty(input_file_sources.len())?;
    for ((source_index, ssr_index), ref_index) in scbs
        .list
        .items_source_index()
        .iter()
        .zip(scbs.list.items_ssr_source_index())
        .zip(scbs.list.items_reference_source_index())
    {
        scb_bitset.set(*source_index as usize);
        scb_bitset.set(*ref_index as usize);
        if (*ssr_index as usize) < scb_bitset.capacity() {
            scb_bitset.set(*ssr_index as usize);
        }
    }

    let mut resolved_index_cache = vec![CachedFileIndex::NONE; input_file_sources.len() * 2];

    // Note: ctx fields `server_seen_bit_set`/`gts` are seeded with
    // placeholders and assigned AFTER Pass 1 (receive_chunk grows `bundled_files`, so the trace bitsets
    // must be sized post-Pass-1). Seed with empty placeholders; real init below.
    let mut gts_storage = GraphTraceState {
        server_bits: DynamicBitSet::default(),
        client_bits: DynamicBitSet::default(),
    };
    let mut ctx = HotUpdateContext {
        import_records,
        sources: input_file_sources,
        loaders: input_file_loaders,
        server_to_client_bitset: scb_bitset,
        resolved_index_cache: &mut resolved_index_cache,
        server_seen_bit_set: DynamicBitSet::default(), // assigned below
        gts: &mut gts_storage,
    };

    let quoted_source_contents = bv2.linker.graph.files.items_quoted_source_contents();

    // Phase 1: index the bundle into the graphs and prepare the server patch.
    let server_patch = cell.with_mut(|dev| -> JsResult<Option<ServerPatch>> {
        let _lock = dev.graph_safety_lock.guard();
        // Pass 1, update the graph's nodes, resolving every bundler source
        // index into its `IncrementalGraph(...).FileIndex`
        let js_chunk = &result.chunks[0];
        debug_assert_eq!(
            js_chunk.content.javascript().parts_in_chunk_in_order.len(),
            js_chunk.compile_results_for_chunk.len()
        );
        for (part_range, compile_result) in js_chunk
            .content
            .javascript()
            .parts_in_chunk_in_order
            .iter()
            .zip(js_chunk.compile_results_for_chunk.iter())
        {
            let index = part_range.source_index;
            let source_map: bun_sourcemap::Chunk = match compile_result.source_map_chunk() {
                Some(c) => c.clone(),
                None => 'brk: {
                    // The source map is `null` if empty
                    debug_assert!(matches!(
                        compile_result,
                        bundler::CompileResult::Javascript {
                            result: bun_js_printer::PrintResult::Result(_),
                            ..
                        }
                    ));
                    debug_assert!(
                        dev.server_transpiler().options.source_map
                            != bundler::options::SourceMapOption::None
                    );
                    debug_assert!(!part_range.source_index.is_runtime());
                    break 'brk bun_sourcemap::Chunk::init_empty();
                }
            };
            let quoted_contents = &quoted_source_contents[part_range.source_index.get() as usize];
            match targets[part_range.source_index.get() as usize].bake_graph() {
                bake::Graph::Client => dev.client_graph_mut().receive_chunk(
                    &mut ctx,
                    index,
                    incremental_graph::ReceiveChunkContent::Js {
                        code: compile_result.code().to_vec().into_boxed_slice(),
                        source_map: Some(incremental_graph::ReceiveChunkSourceMap {
                            chunk: source_map,
                            // `quoted_contents` lives in the per-bundle AST heap,
                            // which is destroyed at bundle end; copy onto the
                            // global heap so the dev-server can hold it across
                            // rebuilds for stack-trace remapping.
                            escaped_source: quoted_contents
                                .as_ref()
                                .map(|v| v.as_slice().to_vec().into_boxed_slice()),
                        }),
                    },
                    false,
                )?,
                graph @ (bake::Graph::Server | bake::Graph::Ssr) => {
                    dev.server_graph_mut().receive_chunk(
                        &mut ctx,
                        index,
                        incremental_graph::ReceiveChunkContent::Js {
                            code: compile_result.code().to_vec().into_boxed_slice(),
                            source_map: Some(incremental_graph::ReceiveChunkSourceMap {
                                chunk: source_map,
                                // `quoted_contents` lives in the per-bundle AST heap,
                                // which is destroyed at bundle end; copy onto the
                                // global heap so the dev-server can hold it across
                                // rebuilds for stack-trace remapping.
                                escaped_source: quoted_contents
                                    .as_ref()
                                    .map(|v| v.as_slice().to_vec().into_boxed_slice()),
                            }),
                        },
                        graph == bake::Graph::Ssr,
                    )?
                }
            }
        }

        for (i, metadata) in (1..1 + n_css).zip(result.css_file_list.values()) {
            debug_assert!(matches!(
                result.chunks[i].content,
                bundler::chunk::Content::Css(_)
            ));

            let index = bun_ast::Index::init(result.chunks[i].entry_point.source_index());

            // `IntermediateOutput::code` takes `&mut self` plus `&Chunk`/`&[Chunk]`
            // views of the same storage; take the output out for the call.
            let code = {
                let mut io = ::core::mem::take(&mut result.chunks[i].intermediate_output);
                let code = io.code(
                    None,
                    &bv2.graph,
                    &bv2.linker.graph,
                    b"THIS_SHOULD_NEVER_BE_EMITTED_IN_DEV_MODE",
                    &result.chunks[i],
                    result.chunks,
                    None,
                    bundler::chunk::ReferencePathStyle::ImporterRelative,
                    bundler::chunk::SourceMapShiftTracking::Disabled,
                );
                result.chunks[i].intermediate_output = io;
                code?
            };

            // Create an entry for this file.
            let key = ctx.sources[index.get() as usize]
                .path
                .key_for_incremental_graph();
            // TODO: use a hash mix with the first half being a path hash and the second half content hash
            let h = hash(key);
            // Track css files that look like tailwind files.
            // Note: hoisted before `replace_path` because that consumes
            // `code.buffer`.
            let looks_like_tailwind = dev.has_tailwind_plugin_hack.is_some() && {
                let first_1024 = &code.buffer[..code.buffer.len().min(1024)];
                strings::index_of(first_1024, b"tailwind").is_some()
            };
            dev.assets.replace_path(
                &mut dev.client_graph,
                dev.server,
                key,
                crate::webcore::blob::Any::from_owned_slice(code.buffer.into()),
                &MimeType::CSS,
                h,
            )?;

            if let Some(map) = &mut dev.has_tailwind_plugin_hack {
                if looks_like_tailwind {
                    // Note: `get_or_put` consumes the key by value; on miss the key
                    // already lives in the map so the explicit `*key_ptr =` is redundant.
                    let _ = map.get_or_put(Box::from(key))?;
                } else {
                    let _ = map.swap_remove(&Box::<[u8]>::from(key));
                }
            }

            dev.client_graph_mut().receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ReceiveChunkContent::Css(h),
                false,
            )?;

            // If imported on server, there needs to be a server-side file entry
            // so that edges can be attached.
            if metadata.imported_on_server {
                dev.server_graph
                    .insert_css_file_on_server(&mut ctx, index, key)?;
            }
        }

        for chunk in result.chunks[1 + n_css..1 + n_css + n_html].iter_mut() {
            let index = bun_ast::Index::init(chunk.entry_point.source_index());
            let generated_js = dev.generate_javascript_code_for_html_file(
                index,
                import_records,
                input_file_sources,
                bv2.graph.input_files.items_loader(),
            )?;
            dev.client_graph_mut().receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ReceiveChunkContent::Js {
                    code: generated_js,
                    source_map: None,
                },
                false,
            )?;
            let client_index = ctx
                .get_cached_index(bake::Side::Client, index)
                .unwrap::<{ bake::Side::Client }>()
                .expect("unresolved index");
            // Not the file of a route: a plugin resolved a route's file to it, or loaded it as html.
            let Some(route_bundle_index) = dev.client_graph.html_route_bundle_index(client_index)
            else {
                continue;
            };
            let route_bundle = &mut dev.route_bundles[route_bundle_index.get() as usize];
            debug_assert!(route_bundle.data.html().bundled_file == client_index);
            if route_bundle
                .data
                .html_mut()
                .cached_response
                .take()
                .is_some()
            {
                route_bundle.invalidate_client_bundle(&mut dev.source_maps);
            }
            let html = match &mut route_bundle.data {
                route_bundle::Data::Html(h) => h,
                _ => unreachable!(),
            };
            let bundler::CompileResult::Html {
                code: compile_result_code,
                script_injection_offset: compile_result_offset,
                ..
            } = chunk.compile_results_for_chunk.get_mut(0)
            else {
                unreachable!()
            };
            // Drops the previous text and transfers ownership of the chunk's
            // compile-result code, leaving an empty
            // boxed slice behind in the chunk — nothing reads it after this.
            html.bundled_html_text = Some(std::mem::take(compile_result_code));
            html.script_injection_offset =
                Some(route_bundle::ByteOffset::init(*compile_result_offset));

            chunk
                .entry_point
                .set_entry_point_id(route_bundle_index.get());
        }

        // Sized AFTER
        // Pass 1 so server/client bitsets cover files just inserted by `receive_chunk`.
        *ctx.gts = dev.init_graph_trace_state(if n_css > 0 {
            input_file_sources.len()
        } else {
            0
        })?;
        ctx.server_seen_bit_set = DynamicBitSet::init_empty(dev.server_graph.bundled_files.len())?;

        dev.incremental_result.had_adjusted_edges = false;

        dev.prepare_and_log_resolution_failures()?;
        dev.report_html_routes_without_html()?;

        // Pass 2, update the graph's edges by performing import diffing on each
        // changed file, removing dependencies. This pass also flags what routes
        // have been modified.
        for part_range in result.chunks[0]
            .content
            .javascript()
            .parts_in_chunk_in_order
            .iter()
        {
            match targets[part_range.source_index.get() as usize].bake_graph() {
                bake::Graph::Server | bake::Graph::Ssr => {
                    dev.server_graph_mut().process_chunk_dependencies(
                        &mut ctx,
                        incremental_graph::ProcessMode::Normal,
                        part_range.source_index,
                    )?
                }
                bake::Graph::Client => dev.client_graph_mut().process_chunk_dependencies(
                    &mut ctx,
                    incremental_graph::ProcessMode::Normal,
                    part_range.source_index,
                )?,
            }
        }
        for chunk in result.chunks[1 + n_css..1 + n_css + n_html].iter() {
            let index = bun_ast::Index::init(chunk.entry_point.source_index());
            dev.client_graph_mut().process_chunk_dependencies(
                &mut ctx,
                incremental_graph::ProcessMode::Normal,
                index,
            )?;
        }
        for chunk in result.chunks[1..1 + n_css].iter() {
            let entry_index = bun_ast::Index::init(chunk.entry_point.source_index());
            dev.client_graph_mut().process_chunk_dependencies(
                &mut ctx,
                incremental_graph::ProcessMode::Css,
                entry_index,
            )?;
        }

        // Index all failed files now that the incremental graph has been updated.
        if !dev.incremental_result.failures_removed.is_empty()
            || !dev.incremental_result.failures_added.is_empty()
        {
            *had_sent_hmr_event = true;
        }
        dev.index_failures()?;

        dev.client_graph.ensure_stale_bit_capacity(false)?;
        dev.server_graph.ensure_stale_bit_capacity(false)?;

        dev.generation = dev.generation.wrapping_add(1);
        if Environment::ENABLE_LOGS {
            debug_log!(
                "Bundle Round {}: {} server, {} client, {} ms",
                dev.generation,
                dev.server_graph.current_chunk_parts.len(),
                dev.client_graph.current_chunk_parts.len(),
                dev.current_bundle
                    .as_ref()
                    .expect("infallible: bundle active")
                    .timer
                    .elapsed()
                    .as_millis(),
            );
        }

        // Load all new chunks into the server runtime.
        if dev.frontend_only || dev.server_graph.current_chunk_len == 0 {
            return Ok(None);
        }
        // Generate a script_id for server bundles

        // Get the source map if available and render to JSON
        let source_map_json = if !dev.server_graph.current_chunk_source_maps.is_empty() {
            // Create a temporary source map entry to render
            let mut source_map_entry = source_map_store::Entry {
                ref_count: 1,
                ..Default::default()
            };

            // Fill the source map entry
            dev.server_graph.take_source_map(&mut source_map_entry)?;
            let source_map_entry = scopeguard::guard(source_map_entry, |mut entry| {
                entry.ref_count = 0;
                entry.deinit();
            });

            Some(source_map_entry.render_json(ChunkKind::HmrChunk, bake::Side::Server)?)
        } else {
            None
        };

        let code = dev.server_graph.take_js_bundle_server(
            &incremental_graph::TakeJSBundleOptionsServer {
                kind: ChunkKind::HmrChunk,
            },
        )?;

        let global = dev.global();
        Ok(Some(ServerPatch {
            code,
            source_map_json,
            register_update: dev.server_register_update_callback.get().unwrap(),
            client_components_added: dev.make_array_for_server_components_patch(
                global,
                &dev.incremental_result.client_components_added,
            )?,
            client_components_removed: dev.make_array_for_server_components_patch(
                global,
                &dev.incremental_result.client_components_removed,
            )?,
        }))
    })?;

    if let Some(patch) = server_patch {
        patch.load(cell.get().global());
    }

    // Phase 2: work out what changed and tell the HMR clients.
    let outcome = cell.with_mut(|dev| -> JsResult<BundleOutcome> {
        let _lock = dev.graph_safety_lock.guard();
        macro_rules! current_bundle {
            () => {
                dev.current_bundle
                    .as_mut()
                    .expect("infallible: bundle active")
            };
        }

        let mut route_bits = DynamicBitSet::init_empty(dev.route_bundles.len())?;
        let mut route_bits_client = DynamicBitSet::init_empty(dev.route_bundles.len())?;

        let mut has_route_bits_set = false;

        let mut hot_update_payload: Vec<u8> = Vec::with_capacity(65536);
        hot_update_payload.push(MessageId::HotUpdate.char());

        // The writer used for the hot_update payload
        macro_rules! w_int {
            ($t:ty, $v:expr) => {
                hot_update_payload.extend_from_slice(&<$t>::to_le_bytes($v))
            };
        }
        macro_rules! w_all {
            ($s:expr) => {
                hot_update_payload.extend_from_slice($s)
            };
        }

        // It was discovered that if a tree falls with nobody around it, it does not
        // make any sound. Let's avoid writing into `w` if no sockets are open.
        let hot_update_subscribers = dev.num_subscribers(HmrTopic::HotUpdate);
        let will_hear_hot_update = hot_update_subscribers > 0;

        // This list of routes affected excludes client code.
        if will_hear_hot_update
            && current_bundle!().had_reload_event
            && (dev.incremental_result.framework_routes_affected.len()
                + dev.incremental_result.html_routes_hard_affected.len())
                > 0
            && dev.bundling_failures.is_empty()
        {
            has_route_bits_set = true;

            for request in &dev.incremental_result.framework_routes_affected {
                let route = dev.router.route_ptr(request.route_index());
                if let Some(id) = route.bundle {
                    route_bits.set(id.get() as usize);
                }
                if request.should_recurse_when_visiting() {
                    mark_all_route_children(
                        &dev.router,
                        &mut [&mut route_bits],
                        request.route_index(),
                    );
                }
            }
            for route_bundle_index in &dev.incremental_result.html_routes_hard_affected {
                route_bits.set(route_bundle_index.get() as usize);
                route_bits_client.set(route_bundle_index.get() as usize);
            }

            // List 1
            let mut it = route_bits.iterator::<true, true>();
            while let Some(bundled_route_index) = it.next() {
                let bundle = &dev.route_bundles[bundled_route_index];
                if bundle.active_viewers == 0 {
                    continue;
                }
                w_int!(i32, i32::try_from(bundled_route_index).expect("int cast"));
            }
        }
        w_int!(i32, -1);

        // When client component roots get updated, the `client_components_affected`
        // list contains the server side versions of these roots.
        if !dev.incremental_result.client_components_affected.is_empty() {
            has_route_bits_set = true;

            dev.incremental_result.framework_routes_affected.clear();
            dev.incremental_result.html_routes_hard_affected.clear();
            dev.incremental_result.html_routes_soft_affected.clear();
            ctx.gts.clear();

            for index in dev.incremental_result.client_components_affected.clone() {
                dev.server_graph_mut().trace_dependencies(
                    index,
                    ctx.gts,
                    incremental_graph::TraceDependencyGoal::NoStop,
                    index,
                )?;
            }

            for request in &dev.incremental_result.framework_routes_affected {
                let route = dev.router.route_ptr(request.route_index());
                if let Some(id) = route.bundle {
                    route_bits.set(id.get() as usize);
                    route_bits_client.set(id.get() as usize);
                }
                if request.should_recurse_when_visiting() {
                    mark_all_route_children(
                        &dev.router,
                        &mut [&mut route_bits, &mut route_bits_client],
                        request.route_index(),
                    );
                }
            }

            // Free old bundles
            let mut it = route_bits_client.iterator::<true, true>();
            while let Some(bundled_route_index) = it.next() {
                dev.route_bundles[bundled_route_index]
                    .invalidate_client_bundle(&mut dev.source_maps);
            }
        } else if !dev.incremental_result.html_routes_hard_affected.is_empty() {
            // Free old bundles
            let mut it = route_bits_client.iterator::<true, true>();
            while let Some(bundled_route_index) = it.next() {
                dev.route_bundles[bundled_route_index]
                    .invalidate_client_bundle(&mut dev.source_maps);
            }
        }

        // Softly affected HTML routes only need the bundle invalidated.
        if !dev.incremental_result.html_routes_soft_affected.is_empty() {
            for index in &dev.incremental_result.html_routes_soft_affected {
                dev.route_bundles[index.get() as usize]
                    .invalidate_client_bundle(&mut dev.source_maps);
                route_bits.set(index.get() as usize);
            }
            has_route_bits_set = true;
        }

        // `route_bits` will have all of the routes that were modified.
        if has_route_bits_set && (will_hear_hot_update || dev.incremental_result.had_adjusted_edges)
        {
            // Note: copy out before the loop so the `&mut RouteBundle` borrow
            // below doesn't overlap a `&dev.incremental_result` read.
            let had_adjusted_edges = dev.incremental_result.had_adjusted_edges;
            let mut it = route_bits.iterator::<true, true>();
            // List 2
            while let Some(i) = it.next() {
                let route_bundle = &mut dev.route_bundles[i];
                if had_adjusted_edges {
                    match &mut route_bundle.data {
                        route_bundle::Data::Framework(fw_bundle) => {
                            fw_bundle.cached_css_file_array.clear_without_deallocation()
                        }
                        route_bundle::Data::Html(html) => html.cached_response = None,
                    }
                }
                if route_bundle.active_viewers == 0 || !will_hear_hot_update {
                    continue;
                }
                let trace_key = route_bundle.trace_key();
                w_int!(i32, i32::try_from(i).expect("int cast"));

                // If no edges were changed, then it is impossible to
                // change the list of CSS files.
                if had_adjusted_edges {
                    ctx.gts.clear();
                    dev.client_graph.current_css_files.clear();
                    dev.trace_all_route_imports(trace_key, ctx.gts, TraceImportGoal::FindCss)?;
                    let css_ids = &dev.client_graph.current_css_files;

                    w_int!(i32, i32::try_from(css_ids.len()).expect("int cast"));
                    for css_id in css_ids {
                        let mut hex = [0u8; 16];
                        let n = bun_core::fmt::bytes_to_hex_lower(&css_id.to_ne_bytes(), &mut hex);
                        w_all!(&hex[..n]);
                    }
                } else {
                    w_int!(i32, -1);
                }
            }
        }
        w_int!(i32, -1);

        let css_chunks = &result.chunks[1..1 + n_css];
        if will_hear_hot_update {
            if dev.client_graph.current_chunk_len > 0 || !css_chunks.is_empty() {
                // Send CSS mutations
                dev.assets.reindex_if_needed()?;
                w_int!(u32, u32::try_from(css_chunks.len()).expect("int cast"));
                use bun_bundler::Graph::InputFileColumns as _;
                let sources = bv2.graph.input_files.items_source();
                for chunk in css_chunks {
                    let key = sources[chunk.entry_point.source_index() as usize]
                        .path
                        .key_for_incremental_graph();
                    let content_hash = hash(key);
                    let mut hex = [0u8; 16];
                    let n =
                        bun_core::fmt::bytes_to_hex_lower(&content_hash.to_ne_bytes(), &mut hex);
                    w_all!(&hex[..n]);
                    let css_data: &[u8] = match dev.assets.get(content_hash) {
                        Some(route) => &route.blob.internal_blob().bytes,
                        None => b"",
                    };
                    w_int!(u32, u32::try_from(css_data.len()).expect("int cast"));
                    w_all!(css_data);
                }

                // Send the JS chunk
                if dev.client_graph.current_chunk_len > 0 {
                    let script_id = 'h: {
                        // Matches the bundler's `ContentHasher` hash (XxHash64).
                        let mut source_map_hash = bun_hash::XxHash64Streaming::new(0x4b12);
                        let keys = dev.client_graph.bundled_files.keys();
                        let values = dev.client_graph.bundled_files.values();
                        for part in &dev.client_graph.current_chunk_parts {
                            source_map_hash.update(&keys[part.get() as usize]);
                            if let Some(map) = values[part.get() as usize].source_map.get() {
                                source_map_hash.update(map.vlq());
                            }
                        }
                        // Set the bottom bit.
                        break 'h source_map_store::Key::init(source_map_hash.digest() | 1);
                    };
                    let mut sockets: u32 = 0;
                    for socket in dev.active_websocket_connections.values() {
                        if socket.is_subscribed(HmrTopic::HotUpdate) {
                            let is_new = socket.referenced_source_maps.with_mut(|maps| {
                                !maps.get_or_put(script_id).expect("oom").found_existing
                            });
                            if is_new {
                                sockets += 1;
                            }
                        }
                    }
                    map_log!("inc {:x}, for {} sockets", script_id.get(), sockets);
                    let entry = match dev
                        .source_maps
                        .put_or_increment_ref_count(script_id, sockets)?
                    {
                        source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => 'brk: {
                            dev.client_graph.take_source_map(entry)?;
                            break 'brk entry;
                        }
                        source_map_store::PutOrIncrementRefCount::Shared(entry) => entry,
                    };
                    w_int!(u32, entry.overlapping_memory_cost);

                    // Build and send the source chunk
                    let console_log = dev.should_receive_console_log_from_browser();
                    dev.client_graph_mut().take_js_bundle_to_list(
                        &mut hot_update_payload,
                        &incremental_graph::TakeJSBundleOptionsClient {
                            kind: crate::bake::dev_server::ChunkKind::HmrChunk,
                            script_id,
                            console_log,
                            ..Default::default()
                        },
                    )?;
                }
            } else {
                w_int!(i32, 0);
            }

            dev.publish(HmrTopic::HotUpdate, &hot_update_payload, Opcode::BINARY);
            *had_sent_hmr_event = true;
        }

        if !dev.incremental_result.failures_added.is_empty() {
            dev.bundles_since_last_error = 0;

            // Only the first failure payload sent notifies the inspector.
            let mut notify_inspector = dev.inspector().is_some();
            // Released on the error paths too (guard), but normally handed out
            // so the final releases happen after this borrow.
            let mut release_after =
                scopeguard::guard(Vec::<crate::server::AnyRequestContext>::new(), |contexts| {
                    for ctx in contexts {
                        ctx.deref();
                    }
                });
            if current_bundle!().promise.strong.has_value() {
                dev.set_current_bundle_route_states(route_bundle::State::PossibleBundlingFailures);
                let global = dev.global();
                let promise = current_bundle!().promise.strong.take();
                current_bundle!().promise.reset();
                dev.send_serialized_failures(
                    DevResponse::Promise(PromiseResponse { promise, global }),
                    dev.bundling_failures.values(),
                    dev.inspector()
                        .filter(|_| ::core::mem::take(&mut notify_inspector)),
                )?;
            }

            while let Some(req) = current_bundle!().requests.pop() {
                let req = scopeguard::guard(req, DeferredRequest::release);

                dev.route_bundle_ptr(req.route_bundle_index).server_state =
                    route_bundle::State::PossibleBundlingFailures;

                let resp: DevResponse = match req.handler.replace(Handler::Aborted) {
                    Handler::Aborted => continue,
                    Handler::ServerHandler(mut saved) => {
                        let resp = saved.response;
                        // Releases the ref taken in `defer_request`; the request
                        // context's own is released once the error page is out
                        // (nothing hands the context to a JS handler that would
                        // finish it).
                        release_after.push(saved.ctx);
                        saved.deinit();
                        DevResponse::Http(resp)
                    }
                    Handler::BundledHtmlPage(ram) => DevResponse::Http(ram.response),
                };

                dev.send_serialized_failures(
                    resp,
                    dev.bundling_failures.values(),
                    dev.inspector()
                        .filter(|_| ::core::mem::take(&mut notify_inspector)),
                )?;
            }
            if notify_inspector {
                let mut buf: Vec<u8> = Vec::new();
                dev.encode_serialized_failures(
                    dev.bundling_failures.values(),
                    &mut buf,
                    dev.inspector(),
                )?;
            }

            return Ok(BundleOutcome::Failed(scopeguard::ScopeGuard::into_inner(
                release_after,
            )));
        }

        if dev.bundling_failures.is_empty() {
            if current_bundle!().had_reload_event {
                let clear_terminal = !bun_output::scope_is_visible!(DevServer)
                    && !dev
                        .vm()
                        .env_loader()
                        .has_set_no_clear_terminal_on_reload(false);
                if clear_terminal {
                    Output::disable_buffering();
                    Output::reset_terminal_all();
                    Output::enable_buffering();
                }

                dev.print_memory_line();

                dev.bundles_since_last_error += 1;
                if dev.bundles_since_last_error > 1 {
                    bun_core::pretty_error!("<cyan>[x{}]<r> ", dev.bundles_since_last_error);
                }
            } else {
                dev.bundles_since_last_error = 0;
                dev.print_memory_line();
            }

            let ms_elapsed = u64::try_from(current_bundle!().timer.elapsed().as_millis()).unwrap();

            bun_core::pretty_error!(
                "<green>{} in {}ms<r>",
                if current_bundle!().had_reload_event {
                    "Reloaded"
                } else {
                    "Bundled page"
                },
                ms_elapsed,
            );

            // Intentionally creating a new scope here so we can limit the lifetime
            // of the `relative_path_buf`
            {
                let mut buf = paths::path_buffer_pool::get();

                // Compute a file name to display
                let file_name: Option<&[u8]> = if current_bundle!().had_reload_event {
                    if !bv2.graph.entry_points.is_empty() {
                        Some(dev.relative_path(&mut *buf, {
                            use bun_bundler::Graph::InputFileColumns as _;
                            bv2.graph.input_files.items_source()
                                [bv2.graph.entry_points[0].get() as usize]
                                .path
                                .text
                        }))
                    } else {
                        None // TODO: How does this happen
                    }
                } else {
                    'brk: {
                        let route_bundle_index = 'rbi: {
                            if let Some(first) = current_bundle!().requests.last() {
                                break 'rbi first.route_bundle_index;
                            }
                            let route_bundle_indices =
                                current_bundle!().promise.route_bundle_indices.keys();
                            if route_bundle_indices.is_empty() {
                                break 'brk None;
                            }
                            break 'rbi route_bundle_indices[0];
                        };

                        // Note: index `route_bundles` immutably so `dev.relative_path`
                        // / `dev.router` / `dev.server_graph` reads below stay disjoint.
                        break 'brk match &dev.route_bundles[route_bundle_index.get() as usize].data
                        {
                            route_bundle::Data::Html(html) => {
                                Some(dev.relative_path(&mut *buf, &html.html_bundle.bundle.path))
                            }
                            route_bundle::Data::Framework(fw) => 'file_name: {
                                let route = dev.router.route_ptr(fw.route_index);
                                let opaque_id = match route.file_page.or(route.file_layout) {
                                    Some(id) => id,
                                    None => break 'file_name None,
                                };
                                let server_index =
                                    from_opaque_file_id::<{ bake::Side::Server }>(opaque_id);
                                let abs_path = &dev.server_graph.bundled_files.keys()
                                    [server_index.get() as usize];
                                break 'file_name Some(dev.relative_path(&mut *buf, abs_path));
                            }
                        };
                    }
                };

                let total_count = bv2.graph.entry_points.len();
                if let Some(name) = file_name {
                    bun_core::pretty_error!("<d>:<r> {}", bstr::BStr::new(name));
                    if total_count > 1 {
                        bun_core::pretty_error!(" <d>+ {} more<r>", total_count - 1);
                    }
                }
            }
            bun_core::pretty_error!("\n");
            Output::flush();

            if let Some(agent) = dev.inspector() {
                agent.notify_bundle_complete(dev.inspector_server_id, ms_elapsed as f64);
            }
        }

        Ok(BundleOutcome::Serve)
    })?;

    match outcome {
        BundleOutcome::Failed(contexts) => {
            for ctx in contexts {
                ctx.deref();
            }
            Ok(())
        }
        BundleOutcome::Serve => finalize_bundle_serve_requests(cell),
    }
}

/// The tail of `finalize_bundle`: hand the finished bundle to every request
/// that was waiting on it. The framework's request handler runs outside the
/// dev server borrow.
fn finalize_bundle_serve_requests(cell: &DevServerCell) -> JsResult<()> {
    cell.with_mut(|dev| -> JsResult<()> {
        // Set all the deferred routes to the .loaded state up front
        let Some(current_bundle) = dev.current_bundle.as_ref() else {
            unreachable!("infallible: bundle active")
        };
        for i in 0..current_bundle.requests.len() {
            let rbi = dev.current_bundle.as_ref().unwrap().requests[i].route_bundle_index;
            dev.route_bundle_ptr(rbi).server_state = route_bundle::State::Loaded;
        }

        if dev
            .current_bundle
            .as_ref()
            .unwrap()
            .promise
            .strong
            .has_value()
        {
            dev.set_current_bundle_route_states(route_bundle::State::Loaded);
            let global = dev.global();
            let mut promise =
                scopeguard::guard(&mut dev.current_bundle.as_mut().unwrap().promise, |p| {
                    p.deinit_idempotently()
                });
            promise.strong.resolve(global, JSValue::TRUE)?;
        }
        Ok(())
    })?;

    loop {
        // Pop the next request and get it ready under the borrow...
        let next = cell.with_mut(|dev| -> JsResult<Option<_>> {
            let Some(req) = dev
                .current_bundle
                .as_mut()
                .expect("infallible: bundle active")
                .requests
                .pop()
            else {
                return Ok(None);
            };
            let req = scopeguard::guard(req, DeferredRequest::release);

            dev.route_bundle_ptr(req.route_bundle_index).server_state = route_bundle::State::Loaded;

            // Note: `SavedRequest` is move-only (`Strong` field). Take the
            // handler by value so the `Saved` payload moves into the union; the
            // request is being released regardless.
            let call = match req.handler.replace(Handler::Aborted) {
                Handler::Aborted => None,
                Handler::ServerHandler(saved) => {
                    let url = match saved.request() {
                        Some(r) => bun_core::StringView::new(r.url.get()),
                        None => bun_core::StringView::EMPTY,
                    };
                    let call = dev
                        .prepare_framework_request(req.route_bundle_index, url.to_utf8().slice());
                    Some((call, saved))
                }
                Handler::BundledHtmlPage(ram) => {
                    dev.on_html_request_with_bundle(
                        req.route_bundle_index,
                        ram.response,
                        ram.method,
                    );
                    None
                }
            };
            Ok(Some((
                scopeguard::ScopeGuard::into_inner(req),
                call,
                dev.server,
            )))
        })?;
        let Some((req, call, server)) = next else {
            return Ok(());
        };
        // ...then run the framework's handler and release it outside.
        let req = scopeguard::guard(req, DeferredRequest::release);
        if let Some((call, saved)) = call {
            let response = saved.response;
            let ctx = saved.ctx;
            // Note: `saved` is moved out (so `release` sees `Aborted`);
            // `js_request: StrongOptional` releases on Drop, but
            // `ctx: AnyRequestContext` is `Copy` — explicitly balance the
            // `ctx.ref_()` from `defer_request` here so the request
            // context's `on_request_complete` (and thus the server's
            // `pending_requests--`) eventually fires. Without this the
            // bake-harness graceful-exit deinit check ("Failed to trigger
            // deinit") never sees DevServer Drop.
            scopeguard::defer! { ctx.deref() };
            call?.run(server, SavedRequestUnion::Saved(saved), response);
        }
        drop(req);
    }
}

impl DevServer {
    fn set_current_bundle_route_states(&mut self, state: route_bundle::State) {
        let Self {
            current_bundle,
            route_bundles,
            ..
        } = self;
        let promise = &current_bundle
            .as_ref()
            .expect("infallible: bundle active")
            .promise;
        for route_bundle_index in promise.route_bundle_indices.keys() {
            route_bundles[route_bundle_index.get() as usize].server_state = state;
        }
    }

    /// If requests, a reload event or a `bundleNewRoute` promise are waiting
    /// on the next bundle, returns that bundle for `start_async_bundle`.
    #[must_use]
    fn start_next_bundle_if_present(&mut self) -> Option<BundleRequest> {
        debug_assert!(self.magic == Magic::Valid);
        // Clear the current bundle
        debug_assert!(self.current_bundle.is_none());
        self.emit_visualizer_message_if_needed();

        // If there were pending requests, begin another bundle.
        if self.next_bundle.reload_event.is_some()
            || !self.next_bundle.requests.is_empty()
            || self.next_bundle.promise.strong.has_value()
        {
            let mut entry_points = EntryPointList::empty();

            let (is_reload, timer) = if let Some(event) = self.next_bundle.reload_event.take() {
                let shared = std::sync::Arc::clone(&self.hot_reload);
                let timer = self.drain_hot_reload_events(&shared, event, &mut entry_points);
                (true, timer)
            } else {
                (false, Instant::now())
            };

            // Note: iterate by index — `route_bundle_ptr` /
            // `append_route_entry_points_if_not_stale` need `&mut self`,
            // conflicting with the `keys()` iterator borrow.
            for i in 0..self.next_bundle.route_queue.len() {
                let route_bundle_index = self.next_bundle.route_queue.keys()[i];
                let rb = self.route_bundle_ptr(route_bundle_index);
                rb.server_state = route_bundle::State::Bundling;
                self.append_route_entry_points_if_not_stale(&mut entry_points, route_bundle_index)
                    .expect("oom");
            }

            self.next_bundle.route_queue.clear_retaining_capacity();

            if !entry_points.set.is_empty() {
                return Some(BundleRequest {
                    entry_points,
                    had_reload_event: is_reload,
                    timer,
                });
            }
        }
        None
    }

    /// Note: The log is not consumed here
    pub(crate) fn handle_parse_task_failure(
        &mut self,
        err: &crate::Error,
        graph: bake::Graph,
        abs_path: &[u8],
        log: &Log,
        bv2: &mut BundleV2,
    ) -> Result<(), AllocError> {
        let graph_lock = self.graph_safety_lock.guard();

        debug_log!(
            "handleParseTaskFailure({}, .{}, {}, {} messages)",
            err.name(),
            <&'static str>::from(graph),
            bun_core::fmt::quote(abs_path),
            log.msgs.len(),
        );

        let mut watch_for_route_file = false;
        if matches!(err.name(), "ENOENT" | "FileNotFound" | "ModuleNotFound") {
            // Special-case files being deleted: the importers report them.
            match graph {
                bake::Graph::Server | bake::Graph::Ssr => {
                    self.server_graph.on_file_deleted(abs_path, bv2)?
                }
                bake::Graph::Client => {
                    self.client_graph.on_file_deleted(abs_path, bv2)?;
                    // The html file of a route has no importer.
                    if let Some(file) = self
                        .client_graph
                        .bundled_files
                        .get(abs_path)
                        .filter(|file| file.html_route_bundle_index.is_some())
                    {
                        // `failed` is cleared by the next successful bundle.
                        watch_for_route_file = !file.failed;
                        self.client_graph_mut().insert_failure(
                            incremental_graph::InsertFailureKey::AbsPath(abs_path),
                            log,
                            false,
                        )?;
                    }
                }
            }
        } else {
            match graph {
                bake::Graph::Server => self.server_graph_mut().insert_failure(
                    incremental_graph::InsertFailureKey::AbsPath(abs_path),
                    log,
                    false,
                )?,
                bake::Graph::Ssr => self.server_graph_mut().insert_failure(
                    incremental_graph::InsertFailureKey::AbsPath(abs_path),
                    log,
                    true,
                )?,
                bake::Graph::Client => self.client_graph_mut().insert_failure(
                    incremental_graph::InsertFailureKey::AbsPath(abs_path),
                    log,
                    false,
                )?,
            }
        }
        // `track_resolution_failure` takes the graph lock itself.
        drop(graph_lock);

        if watch_for_route_file {
            // Bundles the route again once its html file exists, like a failed import.
            self.track_resolution_failure(
                abs_path,
                paths::basename(abs_path),
                bake::Graph::Client,
                Loader::Html,
            )?;
        }
        Ok(())
    }

    /// Return a log to write resolution failures into.
    pub(crate) fn get_log_for_resolution_failures(
        &mut self,
        abs_path: &[u8],
        graph: bake::Graph,
    ) -> crate::Result<&mut Log> {
        debug_assert!(self.current_bundle.is_some());

        let _g = self.graph_safety_lock.guard();

        let owner: serialized_failure::OwnerPacked = if graph == bake::Graph::Client {
            let idx = self
                .client_graph
                .insert_stale(&mut self.assets, abs_path, graph)?;
            serialized_failure::OwnerPacked::new(bake::Side::Client, idx.get())
        } else {
            let idx = self
                .server_graph
                .insert_stale(&mut self.assets, abs_path, graph)?;
            serialized_failure::OwnerPacked::new(bake::Side::Server, idx.get())
        };
        let current_bundle = self
            .current_bundle
            .as_mut()
            .expect("infallible: bundle active");
        let gop = current_bundle
            .resolution_failure_entries
            .get_or_put(owner)?;
        if !gop.found_existing {
            *gop.value_ptr = Log::init();
        }
        Ok(gop.value_ptr)
    }
}

#[derive(Copy, Clone)]
pub struct CacheEntry {
    pub(crate) kind: FileKind,
}

impl DevServer {
    pub(crate) fn is_file_cached(&mut self, path: &[u8], side: bake::Graph) -> Option<CacheEntry> {
        // Barrel files with deferred records must always be re-parsed.
        if self.barrel_files_with_deferrals.contains_key(path) {
            return None;
        }

        let _g = self.graph_safety_lock.guard();

        macro_rules! check {
            ($g:expr) => {{
                let g = $g;
                let index = g.bundled_files.get_index(path)?;
                if !g.stale_files.is_set(index) {
                    return Some(CacheEntry {
                        kind: g
                            .get_file_by_index(incremental_graph::FileIndex::init(
                                u32::try_from(index).expect("int cast"),
                            ))
                            .file_kind(),
                    });
                }
                return None;
            }};
        }
        match side {
            bake::Graph::Client => check!(&self.client_graph),
            bake::Graph::Server | bake::Graph::Ssr => check!(&self.server_graph),
        }
    }

    fn append_opaque_entry_point<const SIDE: bake::Side>(
        &self,
        file_names: &[Box<[u8]>],
        entry_points: &mut EntryPointList,
        optional_id: impl Into<OpaqueFileIdOrOptional>,
    ) -> crate::Result<()> {
        let file = match optional_id.into() {
            OpaqueFileIdOrOptional::Optional(o) => match o {
                Some(f) => f,
                None => return Ok(()),
            },
            OpaqueFileIdOrOptional::Id(f) => f,
        };

        let file_index = from_opaque_file_id::<SIDE>(file);
        let stale = match SIDE {
            bake::Side::Server => self
                .server_graph
                .stale_files
                .is_set(file_index.get() as usize),
            bake::Side::Client => self
                .client_graph
                .stale_files
                .is_set(file_index.get() as usize),
        };
        if stale {
            entry_points.append_js(&file_names[file_index.get() as usize], SIDE.graph())?;
        }
        Ok(())
    }

    pub(crate) fn route_bundle_ptr(&mut self, idx: route_bundle::Index) -> &mut RouteBundle {
        &mut self.route_bundles[idx.get() as usize]
    }
}

pub(super) enum OpaqueFileIdOrOptional {
    Id(OpaqueFileId),
    Optional(framework_router::OpaqueFileIdOptional),
}
impl From<OpaqueFileId> for OpaqueFileIdOrOptional {
    fn from(v: OpaqueFileId) -> Self {
        Self::Id(v)
    }
}
impl From<framework_router::OpaqueFileIdOptional> for OpaqueFileIdOrOptional {
    fn from(v: framework_router::OpaqueFileIdOptional) -> Self {
        Self::Optional(v)
    }
}

fn on_request(
    cell: &DevServerCell,
    req: &mut Request,
    mut resp: AnyResponse,
) -> JsResult<RequestAction> {
    let route_bundle_index = cell.with_mut(|dev| {
        let mut params: framework_router::MatchedParams = Default::default();
        dev.router
            .match_slow(req.url(), &mut params)
            .map(|route_index| {
                dev.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                    .expect("oom")
            })
    });
    if let Some(route_bundle_index) = route_bundle_index {
        let mut ctx = RequestEnsureRouteBundledCtx {
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::ServerHandler,
            route_bundle_index,
            framework_call: None,
        };
        return match ensure_route_is_bundled(cell, route_bundle_index, &mut ctx) {
            Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
            Err(err) => Err(err),
            Ok(()) => Ok(match ctx.framework_call {
                Some(call) => RequestAction::Framework(call),
                None => RequestAction::Done,
            }),
        };
    }

    if !cell.get().server.config().on_request.is_empty() {
        return Ok(RequestAction::UserHandler);
    }

    send_built_in_not_found(&mut resp);
    Ok(RequestAction::Done)
}

impl DevServer {
    /// `Bun.serve`'s HTML-import routes in development: serve the bundled
    /// page for `html`.
    pub(crate) fn respond_for_html_bundle(
        cell: &DevServerCell,
        html: bun_ptr::ThisPtr<HTMLBundleRoute>,
        req: &mut Request,
        resp: AnyResponse,
    ) -> Result<(), AllocError> {
        if !is_allowed_dev_host(cell.get(), req) {
            host_forbidden(resp);
            return Ok(());
        }
        let route_bundle_index = cell
            .with_mut(|dev| dev.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html)))
            .map_err(|_| AllocError)?;
        let mut ctx = RequestEnsureRouteBundledCtx {
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::BundledHtmlPage,
            route_bundle_index,
            framework_call: None,
        };
        match ensure_route_is_bundled(cell, route_bundle_index, &mut ctx) {
            Ok(()) => {}
            // This is the dev server's entry from Bun.serve's static-route
            // trampoline (`StaticRouteLike`, which otherwise never enters
            // JS): what bundling left pending is folded at this boundary.
            Err(err @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) => {
                crate::dispatch::fold(Err(err))
            }
            Err(jsc::JsError::OutOfMemory) => return Err(AllocError),
        }
        Ok(())
    }

    fn get_or_put_route_bundle(
        &mut self,
        route: route_bundle::UnresolvedIndex,
    ) -> crate::Result<route_bundle::Index> {
        let existing = match route {
            route_bundle::UnresolvedIndex::Framework(route_index) => {
                self.router.route_ptr(route_index).bundle
            }
            route_bundle::UnresolvedIndex::Html(html) => html.dev_server_id.get(),
        };
        if let Some(bundle_index) = existing {
            return Ok(bundle_index);
        }

        let _g = self.graph_safety_lock.guard();

        // A file delivers its html to one route bundle only: a route `server.reload()` re-registers reuses it.
        if let route_bundle::UnresolvedIndex::Html(html) = route {
            let html_ref = &*html;
            if let Some(existing) = self
                .client_graph
                .bundled_files
                .get(&html_ref.bundle.path)
                .and_then(|file| file.html_route_bundle_index)
            {
                html_ref.dev_server_id.set(Some(existing));
                return Ok(existing);
            }
        }

        let bundle_index =
            route_bundle::Index::init(u32::try_from(self.route_bundles.len()).expect("int cast"));

        self.route_bundles.reserve(1);
        self.route_bundles.push(RouteBundle {
            data: match route {
                route_bundle::UnresolvedIndex::Framework(route_index) => {
                    route_bundle::Data::Framework(route_bundle::Framework {
                        route_index,
                        cached_module_list: jsc::StrongOptional::empty(),
                        cached_client_bundle_url: jsc::StrongOptional::empty(),
                        cached_css_file_array: jsc::StrongOptional::empty(),
                    })
                }
                route_bundle::UnresolvedIndex::Html(html) => 'brk: {
                    let html_ref = &*html;
                    let incremental_graph_index = self.client_graph.insert_stale_extra(
                        &mut self.assets,
                        &html_ref.bundle.path,
                        bake::Graph::Client,
                        incremental_graph::RouteKind::Route,
                    )?;
                    let file = &mut self.client_graph.bundled_files.values_mut()
                        [incremental_graph_index.get() as usize];
                    file.html_route_bundle_index = Some(bundle_index);
                    break 'brk route_bundle::Data::Html(route_bundle::Html {
                        html_bundle: bun_ptr::RefPtr::from_this(html),
                        bundled_file: incremental_graph_index,
                        script_injection_offset: None,
                        cached_response: None,
                        bundled_html_text: None,
                    });
                }
            },
            client_script_generation: {
                let mut buf = [0u8; 4];
                bun_boringssl_sys::rand_bytes(&mut buf);
                u32::from_ne_bytes(buf)
            },
            server_state: route_bundle::State::Unqueued,
            client_bundle: None,
            active_viewers: 0,
        });
        match route {
            route_bundle::UnresolvedIndex::Framework(route_index) => {
                self.router.route_ptr_mut(route_index).bundle = Some(bundle_index);
            }
            route_bundle::UnresolvedIndex::Html(html) => html.dev_server_id.set(Some(bundle_index)),
        }
        Ok(bundle_index)
    }
}

impl DevServer {
    fn encode_serialized_failures(
        &self,
        failures: &[SerializedFailure],
        buf: &mut Vec<u8>,
        inspector_agent: Option<BunFrontendDevServerAgent<'_>>,
    ) -> Result<(), AllocError> {
        let mut all_failures_len: usize = 0;
        for fail in failures {
            all_failures_len += fail.data.len();
        }
        let mut all_failures: Vec<u8> = Vec::with_capacity(all_failures_len);
        for fail in failures {
            all_failures.extend_from_slice(&fail.data);
        }

        let failures_start_buf_pos = buf.len();

        let len = bun_base64::encode_len(&all_failures);
        // Zero-extend then encode in place; `encode_len` is an upper bound so
        // truncate to the actual encoded length afterward.
        buf.resize(failures_start_buf_pos + len, 0);
        let written = bun_base64::encode(&mut buf[failures_start_buf_pos..], &all_failures);
        buf.truncate(failures_start_buf_pos + written);

        // Re-use the encoded buffer to avoid encoding failures more times than neccecary.
        if let Some(agent) = inspector_agent {
            debug_assert!(agent.is_enabled());
            let failures_encoded = &buf[failures_start_buf_pos..];
            // base64 output is pure ASCII so a UTF-8 borrow is safe.
            agent.notify_bundle_failed(
                self.inspector_server_id,
                BunString::borrow_utf8(failures_encoded),
            );
        }
        Ok(())
    }

    fn send_serialized_failures(
        &self,
        resp: DevResponse,
        failures: &[SerializedFailure],
        inspector_agent: Option<BunFrontendDevServerAgent<'_>>,
    ) -> crate::Result<()> {
        let mut buf: Vec<u8> = Vec::with_capacity(2048);

        let page_title = "Build Failed";
        write!(
            buf,
            concat!(
                "<!doctype html>\n",
                "<html lang=\"en\">\n",
                "<head>\n",
                "<meta charset=\"UTF-8\" />\n",
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n",
                "<title>Bun - {0}</title>\n",
                "<style>:root{{color-scheme:light dark}}body{{background:light-dark(white,black)}}</style>\n",
                "</head>\n",
                "<body>\n",
                "<noscript><h1 style=\"font:28px sans-serif;\">{0}</h1><p style=\"font:20px sans-serif;\">Bun requires JavaScript enabled in the browser to render this error screen, as well as receive hot reloading events.</p></noscript>\n",
                "<script>let error=Uint8Array.from(atob(\"",
            ),
            page_title
        )
        .unwrap();

        self.encode_serialized_failures(failures, &mut buf, inspector_agent)?;

        let pre = const_format::concatcp!(
            "\"),c=>c.charCodeAt(0));let config={bun:\"",
            bun_core::Global::package_json_version_with_canary,
            "\"};"
        );
        let post = "</script></body></html>";

        buf.extend_from_slice(pre.as_bytes());
        buf.extend_from_slice(bun_zstd::embed_compressed!(codegen "bake.error.js"));
        buf.extend_from_slice(post.as_bytes());

        match resp {
            DevResponse::Http(r) => StaticRoute::send_blob_then_deinit(
                r,
                crate::webcore::blob::Any::from_array_list(buf),
                crate::server::static_route::InitFromBytesOptions {
                    mime_type: Some(&MimeType::HTML),
                    server: Some(self.server),
                    status_code: 500,
                    ..Default::default()
                },
            ),
            DevResponse::Promise(mut r) => {
                let global = r.global;
                let mut any_blob = crate::webcore::blob::Any::from_array_list(buf);
                let mut headers = bun_http_jsc::headers_jsc::from_fetch_headers(
                    None,
                    crate::webcore::headers_ref::any_blob_content_type(&any_blob),
                );
                headers.append(b"Content-Type", &MimeType::HTML.value);
                if headers.get(b"etag").is_none() && !any_blob.slice().is_empty() {
                    bun_http::headers::append_etag(any_blob.slice(), &mut headers);
                }
                let headers_ref =
                    bun_http_jsc::headers_jsc::to_fetch_headers_ref(&headers, global)?;
                let response: Response = Response::init(
                    crate::webcore::response::Init {
                        status_code: 500,
                        headers: Some(headers_ref),
                        ..Default::default()
                    },
                    crate::webcore::Body::new(crate::webcore::body::Value::Blob(
                        any_blob.to_blob(global),
                    )),
                    BunString::EMPTY,
                    false,
                );
                let vm = self.vm();
                let _exit = vm.enter_event_loop_scope();
                r.promise.reject(global, Ok(response.to_js(global)))?;
            }
        }
        Ok(())
    }
}

fn send_built_in_not_found<R: ResponseLike>(resp: &mut R) {
    let message = b"404 Not Found";
    resp.write_status(b"404 Not Found");
    resp.end(message, true);
}

impl DevServer {
    fn print_memory_line(&self) {
        if !bun_output::scope_is_visible!(DevServer) {
            return;
        }
        bun_core::pretty_errorln!(
            "<d>DevServer tracked {}, process: {}<r>",
            bun_core::fmt::size(self.memory_cost(), Default::default()),
            bun_core::fmt::size(
                sys::self_process_memory_usage().unwrap_or(0),
                Default::default()
            ),
        );
    }
}

// Note: FileKind/ChunkKind/TraceImportGoal/IncrementalResult/GraphTraceState
// are defined once in `crate::bake::dev_server` and re-exported here so the
// Phase-A draft body and the keystone struct module agree on identity.
pub(super) use crate::bake::dev_server::FileKind;

pub(super) use crate::bake::dev_server::IncrementalResult;

/// Used during an incremental update to determine what "HMR roots"
/// are affected. Re-exported from the keystone `dev_server` module so that
/// `HotUpdateContext.gts` and `IncrementalGraph::trace_dependencies` agree on
/// a single type (the body-local duplicate caused E0308).
pub(super) use crate::bake::dev_server::GraphTraceState;

// GraphTraceState::deinit → Drop on DynamicBitSet (allocator param dropped)

pub(super) use crate::bake::dev_server::TraceImportGoal;

impl DevServer {
    /// `extra_client_bits` is specified if it is possible that the client graph may
    /// increase in size while the bits are being used.
    fn init_graph_trace_state(&self, extra_client_bits: usize) -> crate::Result<GraphTraceState> {
        let server_bits = DynamicBitSet::init_empty(self.server_graph.bundled_files.len())?;
        let client_bits =
            DynamicBitSet::init_empty(self.client_graph.bundled_files.len() + extra_client_bits)?;
        Ok(GraphTraceState {
            server_bits,
            client_bits,
        })
    }
}

// Note: canonical `ChunkKind` lives in `crate::bake::dev_server`; the
// body module re-exports it so both modules name the same type.
pub(super) use crate::bake::dev_server::ChunkKind;

impl DevServer {
    pub fn emit_visualizer_message_if_needed(&mut self) {}

    #[inline]
    fn timer_heap() -> &'static mut crate::timer::All {
        crate::jsc_hooks::timer_all_mut()
    }

    pub fn emit_memory_visualizer_message_timer(&mut self, _: &bun_core::Timespec) {}

    /// `EventLoopTimerTag::DevServerSweepSourceMaps` handler.
    pub fn sweep_source_map_weak_refs(&mut self, now: &bun_core::Timespec) {
        self.source_maps.sweep_weak_refs(now);
        self.emit_memory_visualizer_message_if_needed();
    }

    pub fn emit_memory_visualizer_message_if_needed(&mut self) {}

    pub fn emit_memory_visualizer_message(&mut self) {
        debug_assert!(self.emit_memory_visualizer_events > 0);

        let mut payload: Vec<u8> = Vec::with_capacity(65536);
        payload.push(MessageId::MemoryVisualizer.char());
        if self.write_memory_visualizer_message(&mut payload).is_err() {
            return; // drop packet
        }
        self.publish(HmrTopic::MemoryVisualizer, &payload, Opcode::BINARY);
    }

    pub(crate) fn write_memory_visualizer_message(
        &self,
        payload: &mut Vec<u8>,
    ) -> crate::Result<()> {
        let cost = self.memory_cost_detailed();
        let system_total = crate::node::os::totalmem();
        // Wire format: 10 contiguous native-endian u32s. `[u32; 10]` has no
        // padding and is `bytemuck::Pod`, so the byte view is safe.
        let fields: [u32; 10] = [
            /* incremental_graph_client */ cost.incremental_graph_client as u32,
            /* incremental_graph_server */ cost.incremental_graph_server as u32,
            /* js_code */ cost.js_code as u32,
            /* source_maps */ cost.source_maps as u32,
            /* assets */ cost.assets as u32,
            /* other */ cost.other as u32,
            // No runtime allocation-scope tracker exists; report 0.
            /* devserver_tracked */
            0,
            /* process_used */ sys::self_process_memory_usage().unwrap_or(0) as u32,
            /* system_used */ system_total.saturating_sub(crate::node::os::freemem()) as u32,
            /* system_total */ system_total as u32,
        ];
        payload.extend_from_slice(bytemuck::bytes_of(&fields));

        // SourceMapStore is easy to leak refs in.
        {
            let keys = self.source_maps.entries.keys();
            let values = self.source_maps.entries.values();
            payload.extend_from_slice(&u32::try_from(keys.len()).expect("int cast").to_le_bytes());
            for (key, value) in keys.iter().zip(values) {
                debug_assert!(value.ref_count > 0);
                payload.extend_from_slice(&key.get().to_ne_bytes());
                payload.extend_from_slice(&value.ref_count.to_le_bytes());
                match self.source_maps.locate_weak_ref(*key) {
                    Some(e) => {
                        payload.extend_from_slice(&e.r#ref.count.to_le_bytes());
                        // floats are easier to decode in JS
                        payload.extend_from_slice(&(e.r#ref.expire as f64).to_ne_bytes());
                    }
                    None => {
                        payload.extend_from_slice(&0u32.to_le_bytes());
                    }
                }
                payload.extend_from_slice(&(value.files.len() as u32).to_le_bytes());
                payload.extend_from_slice(&value.overlapping_memory_cost.to_le_bytes());
            }
        }
        Ok(())
    }
}

// Note: MessageId/IncomingMessageId/ConsoleLogKind/HmrTopic are defined
// once in `crate::bake::dev_server` and re-exported here.
pub(super) use crate::bake::dev_server::{HmrTopic, MessageId};

bitflags::bitflags! {
    // bitflags! requires explicit power-of-two values; field names match enum variants.
    #[derive(Default, Copy, Clone)]
    pub struct HmrTopicBits: u8 {
        const HOT_UPDATE = 1 << 0;
        const ERRORS = 1 << 1;
        const BROWSER_ERROR = 1 << 2;
        const INCREMENTAL_VISUALIZER = 1 << 3;
        const MEMORY_VISUALIZER = 1 << 4;
        const TESTING_WATCH_SYNCHRONIZATION = 1 << 5;
    }
}

impl DevServer {
    pub(crate) fn route_to_bundle_index_slow(
        &mut self,
        pattern: &[u8],
    ) -> Option<route_bundle::Index> {
        let mut params: framework_router::MatchedParams = Default::default();
        if let Some(route_index) = self.router.match_slow(pattern, &mut params) {
            return Some(
                self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                    .expect("oom"),
            );
        }
        if let Some(html) = self.html_router.get(pattern) {
            return Some(
                self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))
                    .expect("oom"),
            );
        }
        None
    }
}

mod c {
    use super::*;

    unsafe extern "C" {
        safe fn BakeLoadServerHmrPatch(global: &JSGlobalObject, code: BunString) -> JSValue;
        /// Ownership of `source_map_json` (a leaked `Box<[u8]>`) transfers to
        /// the C++ `DevServerSourceProvider`, which frees it with the default
        /// allocator.
        safe fn BakeLoadServerHmrPatchWithSourceMap(
            global: &JSGlobalObject,
            code: BunString,
            source_map_json: bun_core::ffi::FfiSlice<'static, u8>,
        ) -> JSValue;
        safe fn BakeLoadInitialServerCode(
            global: &JSGlobalObject,
            code: BunString,
            separate_ssr_graph: bool,
        ) -> JSValue;
    }

    pub(super) fn bake_load_server_hmr_patch(
        global: &JSGlobalObject,
        code: BunString,
    ) -> JsResult<JSValue> {
        jsc::from_js_host_call(global, || BakeLoadServerHmrPatch(global, code))
    }

    pub(super) fn bake_load_server_hmr_patch_with_source_map(
        global: &JSGlobalObject,
        code: BunString,
        source_map_json: Box<[u8]>,
    ) -> JsResult<JSValue> {
        let source_map_json = bun_core::ffi::FfiSlice::new(Box::leak(source_map_json));
        jsc::from_js_host_call(global, || {
            BakeLoadServerHmrPatchWithSourceMap(global, code, source_map_json)
        })
    }

    pub(super) fn bake_load_initial_server_code(
        global: &JSGlobalObject,
        code: BunString,
        separate_ssr_graph: bool,
    ) -> JsResult<JSValue> {
        jsc::from_js_host_call(global, || {
            BakeLoadInitialServerCode(global, code, separate_ssr_graph)
        })
    }
}

fn mark_all_route_children(
    router: &FrameworkRouter,
    bits: &mut [&mut DynamicBitSet],
    route_index: framework_router::RouteIndex,
) {
    let mut next = router.route_ptr(route_index).first_child;
    while let Some(child_index) = next {
        let route = router.route_ptr(child_index);
        if let Some(index) = route.bundle {
            for b in bits.iter_mut() {
                b.set(index.get() as usize);
            }
        }
        mark_all_route_children(router, bits, child_index);
        next = route.next_sibling;
    }
}

impl DevServer {
    fn mark_all_route_children_failed(&mut self, route_index: framework_router::RouteIndex) {
        let mut next = self.router.route_ptr(route_index).first_child;
        while let Some(child_index) = next {
            let route = self.router.route_ptr(child_index);
            let bundle = route.bundle;
            let next_sibling = route.next_sibling;
            if let Some(index) = bundle {
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }
            self.mark_all_route_children_failed(child_index);
            next = next_sibling;
        }
    }

    /// The dev server's inspector agent, or `None` while the
    /// `BunFrontendDevServer` domain is disabled. The agent's state is
    /// `Cell`-based, so a shared borrow suffices. JS-thread only.
    pub(crate) fn inspector(&self) -> Option<BunFrontendDevServerAgent<'_>> {
        if let Some(debugger) = self.vm().debugger.as_ref() {
            bun_core::hint::cold();
            let agent = BunFrontendDevServerAgent::from_slot(&debugger.extension_agent);
            if agent.is_enabled() {
                bun_core::hint::cold();
                return Some(agent);
            }
        }
        None
    }
}

impl bun_watcher::WatcherHandler for crate::bake::dev_server::DevWatcherHandler {
    /// Called on watcher's thread; Access to dev-server state restricted.
    fn on_file_update(&mut self, batch: &mut bun_watcher::FileUpdateBatch<'_>) {
        debug_log!("onFileUpdate start");
        scopeguard::defer! { debug_log!("onFileUpdate end") };

        let shared = &self.shared;
        batch.watcher().thread_lock.assert_locked();
        let ev = shared.watcher_acquire_event();
        scopeguard::defer! { shared.watcher_release_and_submit_event(ev) };
        let mut batch = scopeguard::guard(batch, |batch| batch.watcher_mut().flush_evictions());
        let mut files = shared.events[ev as usize].data.lock();

        for i in 0..batch.events().len() {
            let event = batch.events()[i];
            let index = event.index as usize;
            // TODO: why does this out of bounds when you delete every file in the directory?
            if index >= batch.watcher().watchlist.len() {
                continue;
            }

            batch
                .watcher_mut()
                .watchlist
                .slice()
                .items_mut::<"count", u32>()[index] += 1;
            let watchlist = batch.watcher().watchlist.slice();
            let file_path = &watchlist.items_file_path()[index];
            let kind = watchlist.items_kind()[index];

            debug_log!(
                "{} change: {} {}",
                match kind {
                    bun_watcher::Kind::File => "file",
                    bun_watcher::Kind::Directory => "directory",
                },
                bstr::BStr::new(file_path),
                event.op
            );

            match kind {
                bun_watcher::Kind::File => {
                    files.append_file(file_path);

                    if event.op.contains(bun_watcher::Op::DELETE)
                        || event.op.contains(bun_watcher::Op::RENAME)
                    {
                        // TODO: audit this line heavily
                        batch.watcher_mut().remove_at_index::<false>(
                            bun_watcher::Kind::File,
                            event.index,
                            0,
                            &[],
                        );
                    }
                }
                bun_watcher::Kind::Directory => {
                    // Note: `target_os = "linux"` is false on Android, so
                    // include `target_os = "android"` explicitly to
                    // keep forwarding inotify sub-path names there.
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    {
                        // INotifyWatcher stores sub paths into `changed_files`
                        let names = event.names(batch.changed_files());
                        if !names.is_empty() {
                            for maybe_sub_path in names {
                                files.append_dir(file_path, maybe_sub_path.map(|s| s.as_bytes()));
                            }
                        } else {
                            files.append_dir(file_path, None);
                        }
                    }
                    #[cfg(not(any(target_os = "linux", target_os = "android")))]
                    {
                        files.append_dir(file_path, None);
                    }
                }
            }
        }
    }

    fn on_error(&mut self, err: sys::Error) {
        if !err.path.is_empty() {
            let path = err.path.clone();
            Output::err(
                err,
                "failed to watch {} for hot-reloading",
                (bun_core::fmt::quote(&path),),
            );
        } else {
            Output::err(err, "failed to watch files for hot-reloading", ());
        }
        bun_core::warn!(
            "The development server is still running, but hot-reloading is disabled until a restart.",
        );
        // TODO: attempt to automatically restart the watcher thread, perhaps wait for next request.
    }
}

impl DevServer {
    pub(crate) fn publish(&self, topic: HmrTopic, message: &[u8], opcode: Opcode) {
        let _ = self
            .server
            .publish(&topic.uws_topic(), message, opcode, false);
    }

    pub(crate) fn num_subscribers(&self, topic: HmrTopic) -> u32 {
        self.server.num_subscribers(&topic.uws_topic())
    }
}

#[repr(transparent)]
#[derive(Copy, Clone)]
struct SafeFileId(u32);
impl SafeFileId {
    fn new(side: bake::Side, index: u32) -> Self {
        SafeFileId((side as u32) | (index << 1))
    }
    fn side(self) -> bake::Side {
        if (self.0 & 1) == 0 {
            bake::Side::Client
        } else {
            bake::Side::Server
        }
    }
    fn index(self) -> u32 {
        (self.0 >> 1) & 0x3FFF_FFFF
    }
}

/// The `DevServer` state `FrameworkRouter::scan_all` reports discovered route
/// files into.
pub(crate) struct RouterInsertionCtx<'a> {
    pub(crate) server_graph: &'a mut IncrementalGraph<{ bake::Side::Server }>,
    pub(crate) assets: &'a mut Assets,
    pub(crate) route_lookup:
        &'a mut ArrayHashMap<incremental_graph::ServerFileIndex, RouteIndexAndRecurseFlag>,
    pub(crate) root: &'a [u8],
}

impl framework_router::InsertionHandler for RouterInsertionCtx<'_> {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: framework_router::RouteIndex,
        file_kind: framework_router::FileKind,
    ) -> Result<OpaqueFileId, AllocError> {
        let index = self.server_graph.insert_stale_extra(
            self.assets,
            abs_path,
            bake::Graph::Server,
            incremental_graph::RouteKind::Route,
        )?;
        self.route_lookup
            .put(
                index,
                RouteIndexAndRecurseFlag::new(
                    associated_route,
                    file_kind == framework_router::FileKind::Layout,
                ),
            )
            .map_err(|_| AllocError)?;
        Ok(to_opaque_file_id::<{ bake::Side::Server }>(index))
    }

    fn on_router_syntax_error(
        &mut self,
        rel_path: &[u8],
        log: framework_router::TinyLog,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        log.print(rel_path);
        Ok(())
    }

    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: framework_router::FileKind,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        Output::err_generic(
            "Multiple {} matching the same route pattern is ambiguous",
            (ty.collision_noun(),),
        );
        bun_core::pretty_errorln!("  - <blue>{}<r>", bstr::BStr::new(rel_path));
        let mut buf = paths::path_buffer_pool::get();
        bun_core::pretty_errorln!(
            "  - <blue>{}<r>",
            bstr::BStr::new(relative_path(
                self.root,
                &mut buf,
                &self.server_graph.bundled_files.keys()
                    [from_opaque_file_id::<{ bake::Side::Server }>(other_id).get() as usize]
            ))
        );
        Output::flush();
        Ok(())
    }
}

fn to_opaque_file_id<const SIDE: bake::Side>(
    index: incremental_graph::FileIndex<SIDE>,
) -> OpaqueFileId {
    if cfg!(debug_assertions) {
        return OpaqueFileId::init(SafeFileId::new(SIDE, index.get()).0);
    }
    OpaqueFileId::init(index.get())
}

fn from_opaque_file_id<const SIDE: bake::Side>(
    id: OpaqueFileId,
) -> incremental_graph::FileIndex<SIDE> {
    if cfg!(debug_assertions) {
        let safe = SafeFileId(id.get());
        debug_assert!(SIDE == safe.side());
        return incremental_graph::FileIndex::<SIDE>::init(safe.index());
    }
    incremental_graph::FileIndex::<SIDE>::init(id.get())
}

/// Returns posix style path, suitible for URLs and reproducible hashes.
/// The caller must provide a PathBuffer from the pool.
pub(crate) fn relative_path<'a>(
    root: &[u8],
    relative_path_buf: &'a mut PathBuffer,
    path: &'a [u8],
) -> &'a [u8] {
    if !paths::is_absolute(path) {
        return path;
    }

    if path.len() > root.len() && path[root.len()] == b'/' && path.starts_with(root) {
        return &path[root.len() + 1..];
    }

    if path.len() + root.len() * 2 >= paths::MAX_PATH_BYTES {
        return path;
    }

    // `relative_platform_buf` with ALWAYS_COPY=true writes into
    // `relative_path_buf[..len]` (same invariant `relative_buf_z` relies
    // on); capture the length, drop the shared borrow, then re-slice
    // mutably to convert separators in place.
    let rel_len = bun_paths::resolve_path::relative_platform_buf::<
        bun_paths::resolve_path::platform::Auto,
        true,
    >(&mut relative_path_buf[..], root, path)
    .len();
    bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut relative_path_buf[..rel_len]);
    &relative_path_buf[..rel_len]
}

impl DevServer {
    /// See [`relative_path()`].
    pub(crate) fn relative_path<'a>(
        &self,
        relative_path_buf: &'a mut PathBuffer,
        path: &'a [u8],
    ) -> &'a [u8] {
        relative_path(&self.root, relative_path_buf, path)
    }

    /// Either of two conditions make this true:
    /// - The inspector is enabled
    /// - The user passed "console": true in serve options
    fn should_receive_console_log_from_browser(&self) -> bool {
        self.inspector().is_some() || self.broadcast_console_log_from_browser_to_server
    }
}

#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct RouteIndexAndRecurseFlag(pub u32);
impl RouteIndexAndRecurseFlag {
    pub(crate) fn new(
        route_index: framework_router::RouteIndex,
        should_recurse_when_visiting: bool,
    ) -> Self {
        RouteIndexAndRecurseFlag(
            (route_index.get() & 0x7FFF_FFFF) | ((should_recurse_when_visiting as u32) << 31),
        )
    }
    pub(crate) fn route_index(self) -> framework_router::RouteIndex {
        framework_router::RouteIndex::init(self.0 & 0x7FFF_FFFF)
    }
    pub(crate) fn should_recurse_when_visiting(self) -> bool {
        (self.0 >> 31) != 0
    }
}
/// Bake needs to specify which graph (client/server/ssr) each entry point is.
#[derive(Default)]
pub struct EntryPointList {
    pub(crate) set: bun_collections::StringArrayHashMap<entry_point_list::Flags>,
}

pub mod entry_point_list {
    bitflags::bitflags! {
        #[derive(Default, Copy, Clone)]
        #[repr(transparent)]
        pub struct Flags: u8 {
            const CLIENT = 1 << 0;
            const SERVER = 1 << 1;
            const SSR = 1 << 2;
            /// When this is set, also set CLIENT
            const CSS = 1 << 3;
            /// The html file of a route. When this is set, also set CLIENT
            const HTML = 1 << 4;
        }
    }
}

impl EntryPointList {
    pub(crate) fn empty() -> EntryPointList {
        EntryPointList::default()
    }

    pub(crate) fn append_js(&mut self, abs_path: &[u8], side: bake::Graph) -> crate::Result<()> {
        self.append(
            abs_path,
            match side {
                bake::Graph::Server => entry_point_list::Flags::SERVER,
                bake::Graph::Client => entry_point_list::Flags::CLIENT,
                bake::Graph::Ssr => entry_point_list::Flags::SSR,
            },
        )
    }

    pub(crate) fn append_css(&mut self, abs_path: &[u8]) -> crate::Result<()> {
        self.append(
            abs_path,
            entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS,
        )
    }

    /// The html file of a route: an import attribute or a bunfig `[loader]` entry may have made it html.
    pub(crate) fn append_html(&mut self, abs_path: &[u8]) -> crate::Result<()> {
        self.append(
            abs_path,
            entry_point_list::Flags::CLIENT | entry_point_list::Flags::HTML,
        )
    }

    /// Deduplictes requests to bundle the same file twice.
    pub(crate) fn append(
        &mut self,
        abs_path: &[u8],
        flags: entry_point_list::Flags,
    ) -> crate::Result<()> {
        let gop = self.set.get_or_put(abs_path)?;
        if gop.found_existing {
            *gop.value_ptr |= flags;
        } else {
            *gop.value_ptr = flags;
        }
        Ok(())
    }
}

/// This structure does not increment the reference count of its contents, as
/// the lifetime of them are all tied to the underling Bun.serve instance.
/// `<'a>` retained only for the owning `DevServer<'a>`'s `Transpiler` borrows.
#[derive(Default)]
pub struct HTMLRouter {
    pub(crate) map: StringHashMap<bun_ptr::BackRef<HTMLBundleRoute, bun_ptr::Root>>,
    /// If a catch-all route exists, it is not stored in map, but here.
    pub(crate) fallback: Option<bun_ptr::BackRef<HTMLBundleRoute, bun_ptr::Root>>,
}

impl HTMLRouter {
    pub(crate) fn empty() -> HTMLRouter {
        HTMLRouter {
            map: StringHashMap::new(),
            fallback: None,
        }
    }

    pub fn get(&self, path: &[u8]) -> Option<bun_ptr::ThisPtr<HTMLBundleRoute>> {
        self.map
            .get(path)
            .copied()
            .or(self.fallback)
            .map(|r| r.this_ptr())
    }

    pub(crate) fn put(
        &mut self,
        path: &[u8],
        route: bun_ptr::BackRef<HTMLBundleRoute, bun_ptr::Root>,
    ) -> crate::Result<()> {
        if path == b"/*" {
            self.fallback = Some(route);
        } else {
            self.map.put(path, route)?;
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
        self.fallback = None;
    }
}

// HTMLRouter::deinit → Drop on map

impl DevServer {
    pub(crate) fn put_or_overwrite_asset(
        &mut self,
        path: &bun_bundler::bun_fs::Path<'_>,
        contents: crate::webcore::blob::Any,
        content_hash: u64,
    ) -> crate::Result<()> {
        let _g = self.graph_safety_lock.guard();
        let _ = self.assets.replace_path(
            &mut self.client_graph,
            self.server,
            path.text,
            contents,
            &MimeType::by_extension(path.name().ext_without_leading_dot()),
            content_hash,
        )?;
        Ok(())
    }

    pub(crate) fn on_plugins_resolved(
        cell: &DevServerCell,
        plugins: Option<*mut crate::api::js_bundler::Plugin>,
    ) -> crate::Result<()> {
        let next_bundle = cell.with_mut(|dev| {
            dev.bundler_options.plugin = plugins.and_then(::core::ptr::NonNull::new);
            dev.plugin_state = PluginState::Loaded;
            dev.start_next_bundle_if_present()
        });
        match next_bundle {
            Some(next_bundle) => Self::start_async_bundle(cell, next_bundle),
            None => Ok(()),
        }
    }

    /// Returns the requests that were waiting on the plugins; the caller
    /// aborts them (`abort_deferred_requests`) once the dev server borrow ends,
    /// since aborting a request runs its abort-signal handlers.
    pub(crate) fn on_plugins_rejected(&mut self) -> deferred_request::List {
        self.plugin_state = PluginState::Err;
        let requests = ::core::mem::take(&mut self.next_bundle.requests);
        self.next_bundle.route_queue.clear_retaining_capacity();
        // TODO: allow recovery from this state
        requests
    }

    pub(crate) fn abort_deferred_requests(requests: deferred_request::List) {
        for req in requests.into_iter().rev() {
            req.abort();
            DeferredRequest::release(req);
        }
    }
}

/// Problem statement documented on `SCRIPT_UNREF_PAYLOAD`
/// Takes 8 bytes: The generation ID in hex.
struct UnrefSourceMapRequest {
    dev: bun_ptr::BackRef<DevServerCell>,
    server: AnyServer,
}

impl bun_uws::BodyReaderHandler for UnrefSourceMapRequest {
    fn on_body(&mut self, body: &[u8], r: AnyResponse) -> bun_uws_sys::Result<()> {
        if body.len() != 8 {
            return Err(crate::Error::InvalidRequest.into());
        }
        let mut generation_bytes = [0u8; 4];
        strings::decode_hex_to_bytes(&mut generation_bytes, body)
            .map_err(|_| crate::Error::InvalidRequest)?;
        let generation = u32::from_ne_bytes(generation_bytes);
        let source_map_key = source_map_store::Key::init((generation as u64) << 32);
        self.dev.with_mut(|dev| {
            let _ = dev.source_maps.remove_or_upgrade_weak_ref(
                source_map_key,
                source_map_store::RemoveOrUpgradeMode::Remove,
            );
        });
        r.write_status(b"204 No Content");
        r.end(b"", false);
        Ok(())
    }
}

impl Drop for UnrefSourceMapRequest {
    fn drop(&mut self) {
        self.server.on_static_request_complete();
    }
}

impl UnrefSourceMapRequest {
    fn run<R>(dev: &mut DevServer, _: &mut Request, resp: &mut R)
    where
        R: bun_uws_sys::body_reader_mixin::BodyResponse,
    {
        dev.server.on_pending_request();
        bun_uws::BodyReader::read(
            UnrefSourceMapRequest {
                dev: bun_ptr::BackRef::new(dev.this().get()),
                server: dev.server,
            },
            resp,
        );
    }
}

#[derive(Default)]
pub struct TestingBatch {
    /// Keys are borrowed.
    pub(crate) entry_points: EntryPointList,
}

impl TestingBatch {
    pub(crate) fn empty() -> TestingBatch {
        TestingBatch {
            entry_points: EntryPointList::empty(),
        }
    }

    pub(crate) fn append(&mut self, entry_points: &EntryPointList) -> crate::Result<()> {
        debug_assert!(!entry_points.set.is_empty());
        for (k, v) in entry_points
            .set
            .keys()
            .iter()
            .zip(entry_points.set.values())
        {
            self.entry_points.append(k, *v)?;
        }
        Ok(())
    }
}

/// `test/bake/deinitialization.test.ts` checks for this as well as all tests
/// using the dev server test harness.
static DEV_SERVER_DEINIT_COUNT_FOR_TESTING: ::core::sync::atomic::AtomicUsize =
    ::core::sync::atomic::AtomicUsize::new(0);
pub(crate) fn get_deinit_count_for_testing() -> usize {
    DEV_SERVER_DEINIT_COUNT_FOR_TESTING.load(::core::sync::atomic::Ordering::Relaxed)
}

struct PromiseEnsureRouteBundledCtx<'a> {
    global: &'a JSGlobalObject,
    /// The promise handed back to JS: either created here or another handle
    /// to the pending bundle's promise.
    promise: Option<jsc::JSPromiseStrong>,
    route_bundle_index: route_bundle::Index,
    /// The promise was settled synchronously; the caller drains microtasks
    /// once the dev server borrow ends.
    settled: bool,
}

impl<'a> PromiseEnsureRouteBundledCtx<'a> {
    fn promise_mut(&mut self) -> &mut jsc::JSPromise {
        self.promise
            .as_ref()
            .expect("infallible: promise bound")
            .get()
    }

    /// Another strong handle to `self.promise`, creating it if needed.
    fn ensure_promise(&mut self) -> jsc::JSPromiseStrong {
        let global = self.global;
        let value = self
            .promise
            .get_or_insert_with(|| jsc::JSPromiseStrong::init(global))
            .value();
        jsc::JSPromiseStrong::from_value(value, global)
    }

    fn adopt_or_install(&mut self, promise: &mut DeferredPromise) {
        promise
            .route_bundle_indices
            .put(self.route_bundle_index, ())
            .expect("oom");
        if promise.strong.has_value() {
            self.promise = Some(jsc::JSPromiseStrong::from_value(
                promise.strong.value(),
                self.global,
            ));
        } else {
            promise.strong = self.ensure_promise();
        }
    }
}

impl<'a> EnsureRouteCtx for PromiseEnsureRouteBundledCtx<'a> {
    fn on_defer(&mut self, dev: &mut DevServer, bundle_field: BundleQueueType) -> JsResult<()> {
        match bundle_field {
            BundleQueueType::CurrentBundle => {
                let cb = dev
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active");
                self.adopt_or_install(&mut cb.promise);
            }
            BundleQueueType::NextBundle => self.adopt_or_install(&mut dev.next_bundle.promise),
        }
        Ok(())
    }

    fn on_loaded(&mut self, dev: &mut DevServer) -> JsResult<()> {
        let _ = self.ensure_promise();
        let global = self.global;
        self.promise_mut().resolve(global, JSValue::TRUE)?;
        let _ = dev;
        self.settled = true;
        Ok(())
    }

    fn on_plugin_error(&mut self, dev: &mut DevServer) -> JsResult<()> {
        let _ = self.ensure_promise();
        let global = self.global;
        self.promise_mut()
            .reject(global, BunString::static_("Plugin error").to_js(global))?;
        let _ = dev;
        self.settled = true;
        Ok(())
    }

    fn to_dev_response(&mut self, _dev: &mut DevServer) -> DevResponse<'_> {
        DevResponse::Promise(PromiseResponse {
            promise: self.ensure_promise(),
            global: self.global,
        })
    }
}

/// `import.meta.bakeBundleRoute(request, url)` (BakeAdditionsToGlobalObject.cpp).
// HOST_EXPORT(Bake__bundleNewRouteJSFunctionImpl, jsc)
pub fn bundle_new_route_js_function_impl(
    global: &JSGlobalObject,
    request: &mut crate::webcore::Request,
    url_bunstr: &BunString,
) -> JsResult<JSValue> {
    let url = url_bunstr.to_utf8();

    let Some(dev_cell) = request.request_context.get().dev_server_cell() else {
        return Err(global.throw(format_args!(
            "Request context does not belong to dev server"
        )));
    };
    // Extract pathname from URL (remove protocol, host, query, hash)
    let pathname = extract_pathname_from_url(url.slice());

    if pathname.is_empty() || pathname[0] != b'/' {
        return Err(global.throw(format_args!(
            "Invalid path \"{}\" it should be non-empty and start with a slash",
            bstr::BStr::new(pathname)
        )));
    }

    let vm = DevServerCell::get(&dev_cell).vm;
    let _exit = vm.enter_event_loop_scope();
    let route_bundle_index = dev_cell.with_mut(|dev| {
        let mut params: framework_router::MatchedParams = Default::default();
        let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
            return Err(global.throw(format_args!(
                "No route found for path: {}",
                bstr::BStr::new(pathname)
            )));
        };
        Ok(dev
            .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
            .expect("oom"))
    })?;
    let mut ctx = PromiseEnsureRouteBundledCtx {
        global,
        promise: None,
        route_bundle_index,
        settled: false,
    };
    ensure_route_is_bundled(&dev_cell, route_bundle_index, &mut ctx)?;
    if ctx.settled {
        VirtualMachine::get_mut().drain_microtasks();
    }
    {
        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(
            global,
            0,
            JSValue::js_number_from_uint64(route_bundle_index.get() as u64),
        )?;
        array.put_index(
            global,
            1,
            match &ctx.promise {
                Some(p) => p.get().to_js(),
                None => JSValue::UNDEFINED,
            },
        )?;
        Ok(array)
    }
}

// `JSGlobalObject` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`; remaining args
// are by-value `JSValue`s — validity is encoded in the signature.
// C++ side defines `extern "C" SYSV_ABI` (BakeAdditionsToGlobalObject.cpp).
bun_jsc::jsc_abi_extern! {
    safe fn Bake__createDevServerFrameworkRequestArgsObject(
        global: &JSGlobalObject,
        router_type_main: JSValue,
        route_modules: JSValue,
        client_entry_url: JSValue,
        styles: JSValue,
        params: JSValue,
    ) -> JSValue;
}

fn create_dev_server_framework_request_args_object(
    global: &JSGlobalObject,
    router_type_main: JSValue,
    route_modules: JSValue,
    client_entry_url: JSValue,
    styles: JSValue,
    params: JSValue,
) -> JsResult<JSValue> {
    jsc::from_js_host_call(global, || {
        Bake__createDevServerFrameworkRequestArgsObject(
            global,
            router_type_main,
            route_modules,
            client_entry_url,
            styles,
            params,
        )
    })
}

/// `import.meta.bakeNewRouteParams(request, routeBundleIndex, url)`.
// HOST_EXPORT(Bake__getNewRouteParamsJSFunctionImpl)
pub fn new_route_params_for_bundle_promise_for_js(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    if callframe.arguments_count() != 3 {
        return Err(global.throw(format_args!("Expected 3 arguments")));
    }

    let request_js = callframe.argument(0);
    let route_bundle_index_js = callframe.argument(1);
    let url_js = callframe.argument(2);

    if !request_js.is_object() {
        return Err(global.throw(format_args!("Request must be an object")));
    }
    if !route_bundle_index_js.is_any_int() {
        return Err(global.throw(format_args!("Route bundle index must be an integer")));
    }
    if !url_js.is_string() {
        return Err(global.throw(format_args!("URL must be a string")));
    }

    let Some(request) = request_js.as_class_ref::<WebRequest>() else {
        return Err(global.throw(format_args!("Expected a Request object")));
    };
    let Some(dev_cell) = request.request_context.get().dev_server_cell() else {
        return Err(global.throw(format_args!(
            "Request context does not belong to dev server"
        )));
    };

    let route_bundle_index = route_bundle::Index::init(
        u32::try_from(route_bundle_index_js.to_int32()).expect("int cast"),
    );

    let url = url_js.to_bun_string(global)?;
    let url_utf8 = url.to_utf8();

    dev_cell.with_mut(|dev| {
        new_route_params_for_bundle_promise(dev, route_bundle_index, url_utf8.slice())
    })
}

fn new_route_params_for_bundle_promise(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    url: &[u8],
) -> JsResult<JSValue> {
    let expected_route_index = dev.framework_bundle_mut(route_bundle_index).route_index;

    let pathname = extract_pathname_from_url(url);

    let global = dev.global();
    let mut params: framework_router::MatchedParams = Default::default();
    let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
        return Err(global.throw(format_args!(
            "No route found for path: {}",
            bstr::BStr::new(pathname)
        )));
    };
    if route_index != expected_route_index {
        return Err(global.throw(format_args!(
            "Route index mismatch, expected {} but got {}",
            expected_route_index.get(),
            route_index.get()
        )));
    }
    let params_js_value = params.to_js(global);

    let args =
        dev.compute_arguments_for_framework_request(route_bundle_index, params_js_value, false)?;

    create_dev_server_framework_request_args_object(
        global,
        args.router_type_main,
        args.route_modules,
        args.client_id,
        args.styles,
        args.params,
    )
}

// TODO: this is shitty
fn extract_pathname_from_url(url: &[u8]) -> &[u8] {
    // Extract pathname from URL (remove protocol, host, query, hash)
    let mut pathname = if let Some(proto_end) = strings::index_of(url, b"://") {
        &url[proto_end + 3..]
    } else {
        url
    };

    if let Some(path_start) = strings::index_of_char(pathname, b'/') {
        let path_with_query = &pathname[path_start as usize..];
        // Remove query string and hash
        let query_index = strings::index_of_char(path_with_query, b'?')
            .map(|i| i as usize)
            .unwrap_or(path_with_query.len());
        let hash_index = strings::index_of_char(path_with_query, b'#')
            .map(|i| i as usize)
            .unwrap_or(path_with_query.len());
        let end = query_index.min(hash_index);
        pathname = &path_with_query[..end];
    }

    pathname
}

// Type aliases referenced throughout (Phase B will resolve to real paths)
use crate::bake::dev_server::incremental_graph;
use crate::bake::dev_server::route_bundle;
use crate::bake::dev_server::serialized_failure;
use crate::bake::dev_server::source_map_store;
type DebuggerId = jsc::debugger::DebuggerId;
type BunFrontendDevServerAgent<'a> =
    crate::bake::dev_server::inspector_agent::BunFrontendDevServerAgent<'a>;
