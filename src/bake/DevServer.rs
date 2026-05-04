//! Instance of the development server. Attaches to an instance of `Bun.serve`,
//! controlling bundler, routing, and hot module reloading.
//!
//! Reprocessing files that did not change is banned; by having perfect
//! incremental tracking over the project, editing a file's contents (asides
//! adjusting imports) must always rebundle only that one file.
//!
//! All work is held in-memory, using manually managed data-oriented design.
//! For questions about DevServer, please consult the delusional @paperclover

use core::ffi::c_void;
use core::mem::offset_of;
use std::io::Write as _;
use std::time::Instant;

use bun_alloc::{AllocError, Arena};
use bun_collections::{ArrayHashMap, AutoBitSet, DynamicBitSet, HashMap, HiveArray, StringHashMap};
use bun_core::{self as core, Environment, Output};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine,
};
use bun_logger::Log;
use bun_paths::{self as paths, PathBuffer, MAX_PATH_BYTES};
use bun_str::{self as str, strings, String as BunString, ZStr};
use bun_sys as sys;
use bun_uws::{self as uws, AnyResponse, Opcode, Request, WebSocketBehavior, WebSocketUpgradeContext};
use bun_wyhash::{hash, Wyhash};

use bun_bake as bake;
use bun_bake::framework_router::{self as framework_router, FrameworkRouter, OpaqueFileId, Route};
use bun_bundler::{self as bundler, options::Loader, BundleV2, Transpiler};
use bun_http::{Method, MimeType};
use bun_options_types::{ImportKind, ImportRecord};
use bun_runtime::api::server::StaticRoute;
use bun_runtime::api::timer::EventLoopTimer;
use bun_runtime::api::{AnyServer, HTMLBundle, JSBundler, SavedRequest};
use bun_runtime::webcore::{Blob, Request as WebRequest, Response};
use bun_safety::ThreadLock;
use bun_sourcemap::SourceMap;
use bun_watcher::Watcher;

pub use crate::dev_server::assets::Assets;
pub use crate::dev_server::directory_watch_store::DirectoryWatchStore;
pub use crate::dev_server::error_report_request::ErrorReportRequest;
pub use crate::dev_server::hmr_socket::HmrSocket;
pub use crate::dev_server::hot_reload_event::HotReloadEvent;
pub use crate::dev_server::incremental_graph::IncrementalGraph;
pub use crate::dev_server::memory_cost::{self as MemoryCost, *};
pub use crate::dev_server::packed_map::PackedMap;
pub use crate::dev_server::route_bundle::RouteBundle;
pub use crate::dev_server::serialized_failure::SerializedFailure;
pub use crate::dev_server::source_map_store::SourceMapStore;
pub use crate::dev_server::watcher_atomics::WatcherAtomics;

bun_output::declare_scope!(DevServer, visible);
bun_output::declare_scope!(IncrementalGraph, visible);
bun_output::declare_scope!(SourceMapStore, visible);

// TODO(port): `debug` was a Scoped struct (capital S); the macro form differs.
macro_rules! debug_log { ($($t:tt)*) => { bun_output::scoped_log!(DevServer, $($t)*) }; }
macro_rules! ig_log { ($($t:tt)*) => { bun_output::scoped_log!(IncrementalGraph, $($t)*) }; }
macro_rules! map_log { ($($t:tt)*) => { bun_output::scoped_log!(SourceMapStore, $($t)*) }; }
pub(crate) use {debug_log, ig_log, map_log};

pub struct Options<'a> {
    /// Arena must live until DevServer drops
    pub arena: &'a Arena,
    pub root: &'a ZStr,
    pub vm: &'a VirtualMachine,
    pub framework: bake::Framework,
    pub bundler_options: bake::SplitBundlerOptions,
    pub broadcast_console_log_from_browser_to_server: bool,

    // Debugging features
    pub dump_sources: Option<&'static [u8]>,
    pub dump_state_on_crash: Option<bool>,
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        // TODO(port): Zig field defaults; only dump_sources/dump_state_on_crash had defaults
        unimplemented!("Options has required fields without defaults")
    }
}

// The fields `client_graph`, `server_graph`, `directory_watchers`, and `assets`
// all use `@fieldParentPointer` to access DevServer's state. This pattern has
// made it easier to group related fields together, but one must remember those
// structures still depend on the DevServer pointer.

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
    pub bv2: Box<BundleV2>,
    /// Information BundleV2 needs to finalize the bundle
    pub start_data: bundler::DevServerInput,
    /// Started when the bundle was queued
    pub timer: Instant, // TODO(port): std.time.Timer → Instant; .read() becomes .elapsed()
    /// If any files in this bundle were due to hot-reloading, some extra work
    /// must be done to inform clients to reload routes. When this is false,
    /// all entry points do not have bundles yet.
    pub had_reload_event: bool,
    /// After a bundle finishes, these requests will be continued, either
    /// calling their handler on success or sending the error page on failure.
    /// Owned by `deferred_request_pool` in DevServer.
    pub requests: deferred_request::List,
    /// Resolution failures are grouped by incremental graph file index.
    /// Unlike parse failures (`handleParseTaskFailure`), the resolution
    /// failures can be created asynchronously, and out of order.
    pub resolution_failure_entries: ArrayHashMap<serialized_failure::OwnerPacked, Log>,

    /// 1. Always make sure to deinit this promise
    /// 2. Always drain microtasks after resolving it
    pub promise: DeferredPromise,
}

pub struct NextBundle {
    /// A list of `RouteBundle`s which have active requests to bundle it.
    pub route_queue: ArrayHashMap<route_bundle::Index, ()>,
    /// If a reload event exists and should be drained. The information
    /// for this watch event is in one of the `watch_events`
    pub reload_event: Option<*mut HotReloadEvent>, // BORROW_FIELD: ptr into dev.watcher_atomics.events[]
    /// The list of requests that are blocked on this bundle.
    pub requests: deferred_request::List,

    pub promise: DeferredPromise,
}

// TODO(port): `<'a>` must be threaded through all `impl DevServer` blocks in Phase B.
pub struct DevServer<'a> {
    /// To validate the DevServer has not been collected, this can be checked.
    /// When freed, this is set to `undefined`. UAF here also trips ASAN.
    pub magic: Magic,
    /// No overhead in release builds.
    pub allocation_scope: AllocationScope,
    /// Absolute path to project root directory. For the HMR
    /// runtime, its module IDs are strings relative to this.
    pub root: Box<[u8]>,
    /// Unique identifier for this DevServer instance. Used to identify it
    /// when using the debugger protocol.
    pub inspector_server_id: DebuggerId,
    /// Hex string generated by hashing the framework config and bun revision.
    /// Emebedding in client bundles and sent when the HMR Socket is opened;
    /// When the value mismatches the page is forcibly reloaded.
    pub configuration_hash_key: [u8; 16],
    /// The virtual machine (global object) to execute code in.
    pub vm: &'a VirtualMachine,
    /// May be `None` if not attached to an HTTP server yet. When no server is
    /// available, functions taking in requests and responses are unavailable.
    /// However, a lot of testing in this mode is missing, so it may hit assertions.
    pub server: Option<AnyServer>,
    /// Contains the tree of routes. This structure contains FileIndex
    pub router: FrameworkRouter,
    /// Every navigatable route has bundling state here.
    pub route_bundles: Vec<RouteBundle>,
    /// All access into IncrementalGraph is guarded by a ThreadLock. This is
    /// only a debug assertion as contention to this is always a bug; If a bundle is
    /// active and a file is changed, that change is placed into the next bundle.
    pub graph_safety_lock: ThreadLock,
    pub client_graph: IncrementalGraph<{ bake::Side::Client }>,
    pub server_graph: IncrementalGraph<{ bake::Side::Server }>,
    /// Barrel files with deferred (is_unused) import records. These files must
    /// be re-parsed on every incremental build because the set of needed exports
    /// may have changed. Populated by applyBarrelOptimization.
    pub barrel_files_with_deferrals: ArrayHashMap<Box<[u8]>, ()>,
    /// Accumulated barrel export requests across all builds. Maps barrel file
    /// path → set of export names that have been requested. This ensures that
    /// when a barrel is re-parsed in an incremental build, exports requested
    /// by non-stale files (from previous builds) are still kept.
    pub barrel_needed_exports: ArrayHashMap<Box<[u8]>, StringHashMap<()>>,
    /// State populated during bundling and hot updates. Often cleared
    pub incremental_result: IncrementalResult,
    /// Quickly retrieve a framework route's index from its entry point file. These
    /// are populated as the routes are discovered. The route may not be bundled OR
    /// navigatable, such as the case where a layout's index is looked up.
    pub route_lookup: ArrayHashMap<incremental_graph::ServerFileIndex, RouteIndexAndRecurseFlag>,
    /// This acts as a duplicate of the lookup table in uws, but only for HTML routes
    /// Used to identify what route a connected WebSocket is on, so that only
    /// the active pages are notified of a hot updates.
    pub html_router: HTMLRouter,
    /// Assets are accessible via `/_bun/asset/<key>`
    /// This store is not thread safe.
    pub assets: Assets,
    /// Similar to `assets`, specialized for the additional needs of source mappings.
    pub source_maps: SourceMapStore,
    /// All bundling failures are stored until a file is saved and rebuilt.
    /// They are stored in the wire format the HMR runtime expects so that
    /// serialization only happens once.
    pub bundling_failures: ArrayHashMap<SerializedFailure, ()>, // TODO(port): custom hash ctx ArrayHashContextViaOwner
    /// When set, nothing is ever bundled for the server-side,
    /// and DevSever acts purely as a frontend bundler.
    pub frontend_only: bool,
    /// The Plugin API is missing a way to attach filesystem watchers (addWatchFile)
    /// This special case makes `bun-plugin-tailwind` work, which is a requirement
    /// to ship initial incremental bundling support for HTML files.
    pub has_tailwind_plugin_hack: Option<ArrayHashMap<Box<[u8]>, ()>>,

    // These values are handles to the functions in `hmr-runtime-server.ts`.
    // For type definitions, see `./bake.private.d.ts`
    pub server_fetch_function_callback: jsc::StrongOptional,
    pub server_register_update_callback: jsc::StrongOptional,

    // Watching
    pub bun_watcher: Box<Watcher>,
    pub directory_watchers: DirectoryWatchStore,
    pub watcher_atomics: WatcherAtomics,
    /// See doc comment in Zig source.
    pub testing_batch_events: TestingBatchEvents,

    /// Number of bundles that have been executed. This is currently not read, but
    /// will be used later to determine when to invoke graph garbage collection.
    pub generation: usize,
    /// Displayed in the HMR success indicator
    pub bundles_since_last_error: usize,

    pub framework: bake::Framework,
    pub bundler_options: bake::SplitBundlerOptions,
    // Each logical graph gets its own bundler configuration
    pub server_transpiler: Transpiler,
    pub client_transpiler: Transpiler,
    pub ssr_transpiler: Transpiler,
    /// The log used by all `server_transpiler`, `client_transpiler` and `ssr_transpiler`.
    /// Note that it is rarely correct to write messages into it. Instead, associate
    /// messages with the IncrementalGraph file or Route using `SerializedFailure`
    pub log: Log,
    pub plugin_state: PluginState,
    /// See `CurrentBundle` doc comment.
    pub current_bundle: Option<CurrentBundle>,
    /// When `current_bundle` is non-null and new requests to bundle come in,
    /// those are temporaried here. When the current bundle is finished, it
    /// will immediately enqueue this.
    pub next_bundle: NextBundle,
    pub deferred_request_pool: HiveArray<deferred_request::Node, { DeferredRequest::MAX_PREALLOCATED }>,
    /// UWS can handle closing the websocket connections themselves
    pub active_websocket_connections: HashMap<*mut HmrSocket, ()>,

    // Debugging
    #[cfg(feature = "bake_debugging_features")]
    pub dump_dir: Option<sys::Dir>, // TODO(port): std.fs.Dir → bun_sys equivalent
    #[cfg(not(feature = "bake_debugging_features"))]
    pub dump_dir: (),
    /// Reference count to number of active sockets with the incremental_visualizer enabled.
    pub emit_incremental_visualizer_events: u32,
    /// Reference count to number of active sockets with the memory_visualizer enabled.
    pub emit_memory_visualizer_events: u32,
    pub memory_visualizer_timer: EventLoopTimer,

    pub has_pre_crash_handler: bool,
    /// See doc comment in Zig source.
    pub assume_perfect_incremental_bundling: bool,

    /// If true, console logs from the browser will be echoed to the server console.
    pub broadcast_console_log_from_browser_to_server: bool,
}

pub const INTERNAL_PREFIX: &str = "/_bun";
/// Assets which are routed to the `Assets` storage.
pub const ASSET_PREFIX: &str = const_format::concatcp!(INTERNAL_PREFIX, "/asset");
/// Client scripts are available at `/_bun/client/{name}-{rbi}{generation}.js`
/// where:
/// - `name` is the display name of the route, such as "index" or
///          "about". It is ignored when routing.
/// - `rbi` is the route bundle index, in padded hex (e.g. `00000001`)
/// - `generation` which is initialized to a random value. This value is
///                re-randomized whenever `client_bundle` is invalidated.
///
/// Example: `/_bun/client/index-00000000f209a20e.js`
pub const CLIENT_PREFIX: &str = const_format::concatcp!(INTERNAL_PREFIX, "/client");

#[derive(Default)]
pub struct DeferredPromise {
    pub strong: jsc::JSPromiseStrong,
    pub route_bundle_indices: ArrayHashMap<route_bundle::Index, ()>,
}

impl DeferredPromise {
    pub fn set_route_bundle_state(&mut self, dev: &mut DevServer, state: route_bundle::State) {
        for route_bundle_index in self.route_bundle_indices.keys() {
            dev.route_bundle_ptr(*route_bundle_index).server_state = state;
        }
    }

    pub fn reset(&mut self) {
        self.strong.deinit();
        self.route_bundle_indices.clear();
    }

    pub fn deinit_idempotently(&mut self) {
        self.strong.deinit();
        self.route_bundle_indices = Default::default();
    }
}

/// DevServer is stored on the heap, storing its allocator.
pub fn init(options: Options) JsResult<Box<DevServer>> {
    bun_core::analytics::Features::DEV_SERVER.saturating_inc();

    #[cfg(feature = "bake_debugging_features")]
    let dump_dir = if let Some(dir) = options.dump_sources {
        // TODO(port): std.fs.cwd().makeOpenPath - use bun_sys
        match sys::Dir::cwd().make_open_path(dir) {
            Ok(d) => Some(d),
            Err(err) => {
                Output::warn(format_args!("Could not open directory for dumping sources: {}", err));
                None
            }
        }
    } else {
        None
    };
    #[cfg(not(feature = "bake_debugging_features"))]
    let dump_dir = ();
    // TODO(port): errdefer dump_dir.close() — handled by Drop on sys::Dir

    let separate_ssr_graph = options
        .framework
        .server_components
        .as_ref()
        .map(|sc| sc.separate_ssr_graph)
        .unwrap_or(false);

    // TODO(port): Zig used bun.new(DevServer, .{...}) with many `undefined` fields
    // initialized after construction. In Rust we must build the full struct.
    // This is reshaped to compute dependent values first, then construct.
    // PORT NOTE: reshaped for borrowck — many fields were `undefined` then assigned.
    let mut dev = Box::new(DevServer {
        magic: Magic::Valid,
        allocation_scope: AllocationScope::init_default(),
        root: Box::from(options.root.as_bytes()),
        vm: options.vm as *const _,
        server: None,
        directory_watchers: DirectoryWatchStore::EMPTY,
        server_fetch_function_callback: jsc::StrongOptional::EMPTY,
        server_register_update_callback: jsc::StrongOptional::EMPTY,
        generation: 0,
        graph_safety_lock: ThreadLock::init_unlocked(),
        dump_dir,
        framework: options.framework,
        bundler_options: options.bundler_options,
        emit_incremental_visualizer_events: 0,
        emit_memory_visualizer_events: 0,
        memory_visualizer_timer: EventLoopTimer::init_paused(EventLoopTimer::Kind::DevServerMemoryVisualizerTick),
        has_pre_crash_handler: cfg!(feature = "bake_debugging_features")
            && options
                .dump_state_on_crash
                .unwrap_or_else(|| bun_core::feature_flag::BUN_DUMP_STATE_ON_CRASH.get()),
        frontend_only: false, // set below after framework borrowed
        client_graph: IncrementalGraph::EMPTY,
        server_graph: IncrementalGraph::EMPTY,
        barrel_files_with_deferrals: Default::default(),
        barrel_needed_exports: Default::default(),
        incremental_result: IncrementalResult::EMPTY,
        route_lookup: Default::default(),
        route_bundles: Vec::new(),
        html_router: HTMLRouter::EMPTY,
        active_websocket_connections: Default::default(),
        current_bundle: None,
        next_bundle: NextBundle {
            route_queue: Default::default(),
            reload_event: None,
            requests: deferred_request::List::default(),
            promise: DeferredPromise::default(),
        },
        inspector_server_id: DebuggerId::init(0), // TODO paper clover:
        assets: Assets {
            path_map: Default::default(),
            files: Default::default(),
            refs: Default::default(),
        },
        source_maps: SourceMapStore::EMPTY,
        plugin_state: PluginState::Unknown,
        bundling_failures: Default::default(),
        assume_perfect_incremental_bundling: bun_core::feature_flag::BUN_ASSUME_PERFECT_INCREMENTAL
            .get()
            .unwrap_or(cfg!(debug_assertions)),
        testing_batch_events: TestingBatchEvents::Disabled,
        broadcast_console_log_from_browser_to_server: options
            .broadcast_console_log_from_browser_to_server,
        bundles_since_last_error: 0,
        has_tailwind_plugin_hack: None,
        // TODO(port): in-place init — the following were `undefined` in Zig and
        // assigned after `bun.create(DevServer, ...)`. `core::mem::zeroed()` is UB
        // here: `Box<Watcher>` is NonNull-backed, and Transpiler/FrameworkRouter/
        // WatcherAtomics are not `#[repr(C)]` POD. Phase B must either construct
        // these values before building the struct, or use `MaybeUninit<DevServer>`
        // + `ptr::write` per field.
        server_transpiler: todo!("TODO(port): in-place init"),
        client_transpiler: todo!("TODO(port): in-place init"),
        ssr_transpiler: todo!("TODO(port): in-place init"),
        bun_watcher: todo!("TODO(port): in-place init — Box<Watcher> cannot be zeroed"),
        configuration_hash_key: [0; 16],
        router: todo!("TODO(port): in-place init"),
        watcher_atomics: todo!("TODO(port): in-place init"),
        log: Log::default(),
        deferred_request_pool: HiveArray::default(),
    });

    dev.frontend_only = dev.framework.file_system_router_types.is_empty();
    dev.log = Log::init();
    dev.deferred_request_pool = HiveArray::init();

    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
    let global = unsafe { &(*dev.vm).global };

    debug_assert!(core::ptr::eq(dev.server_graph.owner(), &*dev));
    debug_assert!(core::ptr::eq(dev.client_graph.owner(), &*dev));
    debug_assert!(core::ptr::eq(dev.directory_watchers.owner(), &*dev));

    dev.graph_safety_lock.lock();
    let _unlock = scopeguard::guard((), |_| dev.graph_safety_lock.unlock());
    // TODO(port): scopeguard captures &mut dev; Phase B reshaping needed.

    let generic_action = "while initializing development server";
    let fs = match bun_fs::FileSystem::init(options.root) {
        Ok(fs) => fs,
        Err(err) => return Err(global.throw_error(err, generic_action)),
    };

    dev.bun_watcher = match Watcher::init::<DevServer>(&mut *dev, fs) {
        Ok(w) => w,
        Err(err) => {
            return Err(global.throw_error(err, "while initializing file watcher for development server"))
        }
    };

    if let Err(err) = dev.bun_watcher.start() {
        return Err(global.throw_error(
            err,
            "while initializing file watcher thread for development server",
        ));
    }

    dev.watcher_atomics = WatcherAtomics::init(&mut *dev);

    // This causes a memory leak, but the allocator is otherwise used on multiple threads.
    // (allocator param dropped — global mimalloc)

    if let Err(err) = dev.framework.init_transpiler(
        &mut dev.log,
        bake::Mode::Development,
        bake::Graph::Server,
        &mut dev.server_transpiler,
        &mut dev.bundler_options.server,
    ) {
        return Err(global.throw_error(err, generic_action));
    }
    dev.server_transpiler.options.dev_server = Some(&mut *dev as *mut _);
    if let Err(err) = dev.framework.init_transpiler(
        &mut dev.log,
        bake::Mode::Development,
        bake::Graph::Client,
        &mut dev.client_transpiler,
        &mut dev.bundler_options.client,
    ) {
        return Err(global.throw_error(err, generic_action));
    }
    dev.client_transpiler.options.dev_server = Some(&mut *dev as *mut _);

    dev.server_transpiler.resolver.watcher = dev.bun_watcher.get_resolve_watcher();
    dev.client_transpiler.resolver.watcher = dev.bun_watcher.get_resolve_watcher();

    if separate_ssr_graph {
        if let Err(err) = dev.framework.init_transpiler(
            &mut dev.log,
            bake::Mode::Development,
            bake::Graph::Ssr,
            &mut dev.ssr_transpiler,
            &mut dev.bundler_options.ssr,
        ) {
            return Err(global.throw_error(err, generic_action));
        }
        dev.ssr_transpiler.options.dev_server = Some(&mut *dev as *mut _);
        dev.ssr_transpiler.resolver.watcher = dev.bun_watcher.get_resolve_watcher();
    }

    debug_assert!(dev.server_transpiler.resolver.opts.target != bundler::Target::Browser);
    debug_assert!(dev.client_transpiler.resolver.opts.target == bundler::Target::Browser);

    dev.framework = match dev.framework.resolve(
        &mut dev.server_transpiler.resolver,
        &mut dev.client_transpiler.resolver,
        options.arena,
    ) {
        Ok(f) => f,
        Err(_) => {
            if dev.framework.is_built_in_react {
                bake::Framework::add_react_install_command_note(&mut dev.log)?;
            }
            return Err(global.throw_value(
                dev.log
                    .to_js_aggregate_error(global, BunString::static_("Framework is missing required files!"))?,
            ));
        }
    };

    // errdefer dev.route_lookup.clearAndFree() / client_graph.deinit() / server_graph.deinit()
    // — handled by Drop

    dev.configuration_hash_key = 'hash_key: {
        let mut h = Wyhash::init(128);

        if cfg!(debug_assertions) {
            let stat = sys::stat(
                bun_core::self_exe_path().unwrap_or_else(|e| Output::panic(format_args!("unhandled {}", e))),
            )
            .unwrap()
            .unwrap_or_else(|e| Output::panic(format_args!("unhandled {}", e)));
            bun_core::write_any_to_hasher(&mut h, &stat.mtime());
            h.update(bake::get_hmr_runtime(bake::Side::Client).code);
            h.update(bake::get_hmr_runtime(bake::Side::Server).code);
        } else {
            h.update(Environment::GIT_SHA_SHORT.as_bytes());
        }

        for fsr in &dev.framework.file_system_router_types {
            bun_core::write_any_to_hasher(&mut h, &fsr.allow_layouts);
            bun_core::write_any_to_hasher(&mut h, &fsr.ignore_underscores);
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
            bun_core::write_any_to_hasher(&mut h, &true);
            bun_core::write_any_to_hasher(&mut h, &sc.separate_ssr_graph);
            h.update(&sc.client_register_server_reference);
            h.update(&[0]);
            h.update(&sc.server_register_client_reference);
            h.update(&[0]);
            h.update(&sc.server_register_server_reference);
            h.update(&[0]);
            h.update(&sc.server_runtime_import);
            h.update(&[0]);
        } else {
            bun_core::write_any_to_hasher(&mut h, &false);
        }

        if let Some(rfr) = &dev.framework.react_fast_refresh {
            bun_core::write_any_to_hasher(&mut h, &true);
            h.update(&rfr.import_source);
        } else {
            bun_core::write_any_to_hasher(&mut h, &false);
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
            bun_core::write_any_to_hasher(&mut h, &v.tag()); // TODO(port): activeTag
            h.update(v.data_slice()); // TODO(port): switch (v) { inline else => |data| data }
            h.update(&[0]);
        }
        h.update(&[0]);

        break 'hash_key bun_core::fmt::bytes_to_hex_lower(&h.final_().to_ne_bytes());
    };

    // Add react fast refresh if needed. This is the first file on the client side,
    // as it will be referred to by index.
    if let Some(rfr) = &dev.framework.react_fast_refresh {
        debug_assert!(
            dev.client_graph.insert_stale(&rfr.import_source, false)?
                == IncrementalGraph::<{ bake::Side::Client }>::REACT_REFRESH_INDEX
        );
    }

    if !dev.frontend_only {
        dev.init_server_runtime();
    }

    // Initialize FrameworkRouter
    dev.router = 'router: {
        let mut types: Vec<framework_router::Type> =
            Vec::with_capacity(dev.framework.file_system_router_types.len());

        for (i, fsr) in dev.framework.file_system_router_types.iter().enumerate() {
            let buf = paths::path_buffer_pool().get();
            let joined_root =
                paths::join_abs_string_buf(&dev.root, &mut *buf, &[&fsr.root], paths::Style::Auto);
            let Some(entry) = dev
                .server_transpiler
                .resolver
                .read_dir_info_ignore_error(joined_root)
            else {
                continue;
            };

            let server_file = dev
                .server_graph
                .insert_stale_extra(&fsr.entry_server, false, true)?;

            types.push(framework_router::Type {
                abs_root: strings::without_trailing_slash(entry.abs_path).into(),
                prefix: fsr.prefix.clone(),
                ignore_underscores: fsr.ignore_underscores,
                ignore_dirs: fsr.ignore_dirs.clone(),
                extensions: fsr.extensions.clone(),
                style: fsr.style,
                allow_layouts: fsr.allow_layouts,
                server_file: to_opaque_file_id::<{ bake::Side::Server }>(server_file),
                client_file: if let Some(client) = &fsr.entry_client {
                    to_opaque_file_id::<{ bake::Side::Client }>(
                        dev.client_graph.insert_stale(client, false)?,
                    )
                    .to_optional()
                } else {
                    OpaqueFileId::Optional::NONE
                },
                server_file_string: jsc::StrongOptional::EMPTY,
            });

            dev.route_lookup.put(
                server_file,
                RouteIndexAndRecurseFlag {
                    route_index: framework_router::Route::Index::init(u32::try_from(i).unwrap()),
                    should_recurse_when_visiting: true,
                },
            )?;
        }

        break 'router FrameworkRouter::init_empty(&dev.root, types)?;
    };

    // TODO: move scanning to be one tick after server startup. this way the
    // line saying the server is ready shows quicker, and route errors show up
    // after that line.
    dev.scan_initial_routes()?;

    #[cfg(feature = "bake_debugging_features")]
    if dev.has_pre_crash_handler {
        bun_crash_handler::append_pre_crash_handler::<DevServer>(&mut *dev, dump_state_due_to_crash)?;
    }

    debug_assert!(dev.magic == Magic::Valid);

    Ok(dev)
}

impl Drop for DevServer {
    fn drop(&mut self) {
        debug_log!("deinit");
        DEV_SERVER_DEINIT_COUNT_FOR_TESTING
            .fetch_add(1, core::sync::atomic::Ordering::Relaxed)
            .saturating_add(0); // TODO(port): saturating += on static

        // TODO(port): Zig used `useAllFields(DevServer, .{...})` to ensure every field
        // was visited. In Rust, Drop on each field handles most freeing automatically.
        // Only side-effecty cleanup is kept here.

        // WebSockets should be deinitialized before other parts.
        // `websocket.close()` synchronously dispatches `HmrSocket.onClose`,
        // which calls `dev.active_websocket_connections.remove(s)` and
        // destroys the `HmrSocket`. Snapshot the keys first.
        {
            let count = self.active_websocket_connections.len();
            if count > 0 {
                let sockets: Vec<*mut HmrSocket> = self
                    .active_websocket_connections
                    .keys()
                    .copied()
                    .collect();
                for s in sockets {
                    // SAFETY: s is a valid HmrSocket ptr owned by the connection map
                    if let Some(websocket) = unsafe { (*s).underlying } {
                        websocket.close();
                    }
                }
            }
            debug_assert!(self.active_websocket_connections.is_empty());
        }

        if self.memory_visualizer_timer.state == EventLoopTimer::State::ACTIVE {
            // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
            unsafe { (*self.vm).timer.remove(&mut self.memory_visualizer_timer) };
        }
        self.graph_safety_lock.lock();
        // bun_watcher is Box<Watcher> — Drop handles, but Zig passed `true` for stop-thread.
        // TODO(port): Watcher::deinit(true) semantics — ensure Drop stops thread.

        #[cfg(feature = "bake_debugging_features")]
        if let Some(dir) = self.dump_dir.take() {
            drop(dir);
        }

        if self.has_pre_crash_handler {
            bun_crash_handler::remove_pre_crash_handler(self);
        }

        for failure in self.bundling_failures.keys() {
            failure.deinit(self);
        }

        if self.current_bundle.is_some() {
            debug_assert!(false); // impossible to de-initialize this state correctly.
        }

        {
            let mut r = self.next_bundle.requests.first;
            while let Some(request) = r {
                // SAFETY: intrusive list node
                let request = unsafe { &mut *request };
                debug_assert!(!matches!(request.data.handler, Handler::ServerHandler(_)));
                let next = request.next;
                request.data.deref_();
                r = next;
            }
            self.next_bundle.promise.deinit_idempotently();
        }

        for value in self.source_maps.entries.values_mut() {
            debug_assert!(value.ref_count > 0);
            value.ref_count = 0;
            value.deinit();
        }
        if self.source_maps.weak_ref_sweep_timer.state == EventLoopTimer::State::ACTIVE {
            // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
            unsafe { (*self.vm).timer.remove(&mut self.source_maps.weak_ref_sweep_timer) };
        }

        for event in &mut self.watcher_atomics.events {
            event.dirs.clear();
            event.files.clear();
            event.extra_files.clear();
        }

        if let TestingBatchEvents::Enabled(batch) = &mut self.testing_batch_events {
            drop(core::mem::take(&mut batch.entry_points));
        }

        debug_assert!(self.magic == Magic::Valid);
        // self.magic = undefined — no Rust equivalent; freed memory.

        // allocation_scope dropped last automatically by field order.
        // TODO(port): if AllocationScope::ENABLED, deinit happens via Drop.
    }
}

// TODO(port): AllocationScope = bun.allocators.AllocationScopeIn(bun.DefaultAllocator)
pub type AllocationScope = bun_alloc::AllocationScope;
pub type DevAllocator = bun_alloc::AllocationScopeBorrowed;

impl DevServer {
    pub fn allocator(&self) -> &dyn bun_alloc::Allocator {
        self.allocation_scope.allocator()
    }

    pub fn dev_allocator(&self) -> DevAllocator {
        self.allocation_scope.borrow()
    }
}

// re-exports from memory_cost module already declared at top

impl DevServer {
    fn init_server_runtime(&mut self) {
        let runtime = BunString::static_(bake::get_hmr_runtime(bake::Side::Server).code);

        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*self.vm).global };
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
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                unsafe { &*self.vm }.print_error_like_object_to_console(global.take_exception(err));
                panic!("Server runtime failed to start. The above error is always a bug in Bun");
            }
        };

        if !interface.is_object() {
            panic!("Internal assertion failure: expected interface from HMR runtime to be an object");
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
    fn scan_initial_routes(&mut self) -> Result<(), bun_core::Error> {
        self.router.scan_all(
            &mut self.server_transpiler.resolver,
            FrameworkRouter::InsertionContext::wrap::<DevServer>(self),
        )?;

        self.server_graph.ensure_stale_bit_capacity(true)?;
        self.client_graph.ensure_stale_bit_capacity(true)?;
        Ok(())
    }

    /// Returns true if a catch-all handler was attached.
    pub fn set_routes<S>(&mut self, server: &mut S) -> Result<bool, bun_core::Error>
    where
        S: uws::ServerLike, // TODO(port): `server: anytype` — bound by methods called below
    {
        // TODO: all paths here must be prefixed with publicPath if set.
        self.server = Some(AnyServer::from(server));
        let app = server.app().unwrap();
        // TODO(port): `is_ssl` was extracted via @typeInfo(@TypeOf(app)).pointer.child.is_ssl
        let is_ssl = S::IS_SSL;

        macro_rules! route {
            ($method:ident, $path:expr, $handler:expr) => {
                app.$method($path, self as *mut _, wrap_generic_request_handler::<_, { is_ssl }>($handler));
            };
        }
        // TODO(port): comptime string concat → const_format::concatcp!
        route!(get, const_format::concatcp!(CLIENT_PREFIX, "/:route"), on_js_request);
        route!(get, const_format::concatcp!(ASSET_PREFIX, "/:asset"), on_asset_request);
        route!(get, const_format::concatcp!(INTERNAL_PREFIX, "/src/*"), on_src_request);
        route!(post, const_format::concatcp!(INTERNAL_PREFIX, "/report_error"), ErrorReportRequest::run);
        route!(post, const_format::concatcp!(INTERNAL_PREFIX, "/unref"), UnrefSourceMapRequest::run);

        route!(any, INTERNAL_PREFIX, on_not_found);

        app.ws(
            const_format::concatcp!(INTERNAL_PREFIX, "/hmr"),
            self as *mut _,
            0,
            WebSocketBehavior::wrap::<DevServer, HmrSocket, { is_ssl }>(Default::default()),
        );

        #[cfg(feature = "bake_debugging_features")]
        {
            route!(get, const_format::concatcp!(INTERNAL_PREFIX, "/incremental_visualizer"), on_incremental_visualizer);
            route!(get, const_format::concatcp!(INTERNAL_PREFIX, "/memory_visualizer"), on_memory_visualizer);
            app.get(
                const_format::concatcp!(INTERNAL_PREFIX, "/iv"),
                self as *mut _,
                redirect_handler::<{ is_ssl }>(const_format::concatcp!(INTERNAL_PREFIX, "/incremental_visualizer").as_bytes()),
            );
            app.get(
                const_format::concatcp!(INTERNAL_PREFIX, "/mv"),
                self as *mut _,
                redirect_handler::<{ is_ssl }>(const_format::concatcp!(INTERNAL_PREFIX, "/memory_visualizer").as_bytes()),
            );
        }

        // Only attach a catch-all handler if the framework has filesystem router
        // types. Otherwise, this can just be Bun.serve's default handler.
        if !self.framework.file_system_router_types.is_empty() {
            route!(any, "/*", on_request);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

fn on_not_found(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    not_found(resp);
}

fn not_found(resp: AnyResponse) {
    resp.corked(on_not_found_corked, (resp,));
}

fn on_not_found_corked(resp: AnyResponse) {
    resp.write_status("404 Not Found");
    resp.end("Not Found", false);
}

fn on_outdated_js_corked(resp: AnyResponse) {
    // Send a payload to instantly reload the page. This only happens when the
    // client bundle is invalidated while the page is loading, aka when you
    // perform many file updates that cannot be hot-updated.
    resp.write_status("200 OK");
    resp.write_header("Content-Type", MimeType::JAVASCRIPT.value);
    resp.end(
        "try{location.reload()}catch(_){}\n\
         addEventListener(\"DOMContentLoaded\",function(event){location.reload()})",
        false,
    );
}

fn on_js_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    let route_id = req.parameter(0);
    let is_map = strings::has_suffix(route_id, b".js.map");
    if !is_map && !strings::has_suffix(route_id, b".js") {
        return not_found(resp);
    }
    let min_len = b"00000000FFFFFFFF.js".len() + if is_map { b".map".len() } else { 0 };
    if route_id.len() < min_len {
        return not_found(resp);
    }
    let hex = &route_id[route_id.len() - min_len..][..core::mem::size_of::<u64>() * 2];
    if hex.len() != core::mem::size_of::<u64>() * 2 {
        return not_found(resp);
    }
    let Some(id) = parse_hex_to_int::<u64>(hex) else {
        return not_found(resp);
    };

    if is_map {
        // SAFETY: SourceId is #[repr(transparent)] over u64 (same size as id)
        let source_id: source_map_store::SourceId = unsafe { core::mem::transmute(id) };
        let Some(entry) = dev.source_maps.entries.get_mut(&source_map_store::Key::init(id)) else {
            return not_found(resp);
        };
        // PERF(port): was ArenaAllocator — using global heap
        let json_bytes = entry
            .render_json(dev, source_id.kind, bake::Side::Client)
            .expect("oom");
        let response = StaticRoute::init_from_any_blob(
            &Blob::Any::from_owned_slice(json_bytes),
            StaticRoute::Options {
                server: dev.server,
                mime_type: &MimeType::JSON,
                ..Default::default()
            },
        );
        let _deref = scopeguard::guard((), |_| response.deref_());
        response.on_request(uws::AnyRequest::H1(req), resp);
        return;
    }

    let route_bundle_index = route_bundle::Index::init(u32::try_from(id & 0xFFFFFFFF).unwrap());
    let generation: u32 = u32::try_from(id >> 32).unwrap();

    if route_bundle_index.get() as usize >= dev.route_bundles.len() {
        return not_found(resp);
    }

    let route_bundle = &dev.route_bundles[route_bundle_index.get() as usize];
    if route_bundle.client_script_generation != generation
        || route_bundle.server_state != route_bundle::State::Loaded
    {
        return resp.corked(on_outdated_js_corked, (resp,));
    }

    dev.on_js_request_with_bundle(
        route_bundle_index,
        resp,
        Method::which(req.method()).unwrap_or(Method::POST),
    );
}

fn on_asset_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    let param = req.parameter(0);
    if param.len() < core::mem::size_of::<u64>() * 2 {
        return not_found(resp);
    }
    let hex = &param[..core::mem::size_of::<u64>() * 2];
    let mut out = [0u8; core::mem::size_of::<u64>()];
    let Ok(decoded) = bun_core::fmt::hex_to_bytes(&mut out, hex) else {
        return not_found(resp);
    };
    debug_assert!(decoded.len() == core::mem::size_of::<u64>());
    let hash: u64 = u64::from_ne_bytes(out);
    debug_log!("onAssetRequest {} {}", hash, bstr::BStr::new(param));
    let Some(asset) = dev.assets.get(hash) else {
        return not_found(resp);
    };
    req.set_yield(false);
    asset.on(resp);
}

pub fn parse_hex_to_int<T>(slice: &[u8]) -> Option<T>
where
    T: bytemuck::Pod, // TODO(port): @bitCast on [@sizeOf(T)]u8
{
    let mut out = [0u8; core::mem::size_of::<T>()];
    let decoded = bun_core::fmt::hex_to_bytes(&mut out, slice).ok()?;
    debug_assert!(decoded.len() == core::mem::size_of::<T>());
    // SAFETY: out has size_of::<T>() bytes fully initialized by hex_to_bytes; T: Pod
    Some(unsafe { core::ptr::read(out.as_ptr() as *const T) })
}

// TODO(port): `wrapGenericRequestHandler` returned a comptime-generated fn that
// adapts a handler taking `AnyResponse` to one taking `*uws.NewApp(is_ssl).Response`.
// This is a Zig comptime type-generator. In Rust, this becomes a generic adapter fn.
#[inline]
fn wrap_generic_request_handler<H, const IS_SSL: bool>(
    handler: H,
) -> impl Fn(&mut DevServer, &mut Request, *mut uws::NewAppResponse<IS_SSL>)
where
    H: Fn(&mut DevServer, &mut Request, AnyResponse),
{
    // TODO(port): Zig inspected fn_info.params[2].type to decide AnyResponse vs raw.
    move |dev, req, resp| {
        debug_assert!(dev.magic == Magic::Valid);
        handler(dev, req, AnyResponse::init(resp));
    }
}

#[inline]
fn redirect_handler<const IS_SSL: bool>(
    path: &'static [u8],
) -> impl Fn(&mut DevServer, &mut Request, *mut uws::NewAppResponse<IS_SSL>) {
    move |_dev, _req, resp| {
        // SAFETY: resp is valid for the duration of the callback
        let resp = unsafe { &mut *resp };
        resp.write_status(b"302 Found");
        resp.write_header(b"Location", path);
        resp.end(b"Redirecting...", false);
    }
}

fn on_incremental_visualizer(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    resp.corked(on_incremental_visualizer_corked, (resp,));
}

fn on_incremental_visualizer_corked(resp: AnyResponse) {
    let code = if Environment::CODEGEN_EMBED {
        include_bytes!("incremental_visualizer.html").as_slice()
    } else {
        bun_core::runtime_embed_file(bun_core::EmbedKind::SrcEager, "bake/incremental_visualizer.html")
    };
    resp.end(code, false);
}

fn on_memory_visualizer(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    resp.corked(on_memory_visualizer_corked, (resp,));
}

fn on_memory_visualizer_corked(resp: AnyResponse) {
    let code = if Environment::CODEGEN_EMBED {
        include_bytes!("memory_visualizer.html").as_slice()
    } else {
        bun_core::runtime_embed_file(bun_core::EmbedKind::SrcEager, "bake/memory_visualizer.html")
    };
    resp.end(code, false);
}

struct RequestEnsureRouteBundledCtx<'a> {
    dev: &'a mut DevServer,
    req: ReqOrSaved,
    resp: AnyResponse,
    kind: deferred_request::HandlerKind,
    route_bundle_index: route_bundle::Index,
}

impl<'a> RequestEnsureRouteBundledCtx<'a> {
    fn on_defer(&mut self, bundle_field: BundleQueueType) -> JsResult<()> {
        // PORT NOTE: reshaped for borrowck — captured args before re-borrowing dev
        let route_bundle_index = self.route_bundle_index;
        let kind = self.kind;
        let req = core::mem::replace(&mut self.req, ReqOrSaved::Aborted); // TODO(port): ReqOrSaved moved into deferRequest
        let resp = self.resp;
        let requests_array: *mut deferred_request::List = match bundle_field {
            BundleQueueType::CurrentBundle => &mut self.dev.current_bundle.as_mut().unwrap().requests,
            BundleQueueType::NextBundle => &mut self.dev.next_bundle.requests,
        };
        // SAFETY: requests_array points into self.dev which is still valid
        self.dev
            .defer_request(unsafe { &mut *requests_array }, route_bundle_index, kind, req, resp)?;
        Ok(())
    }

    fn on_loaded(&mut self) -> JsResult<()> {
        match self.kind {
            deferred_request::HandlerKind::ServerHandler => self.dev.on_framework_request_with_bundle(
                self.route_bundle_index,
                match &self.req {
                    ReqOrSaved::Req(r) => SavedRequest::Union::Stack(*r),
                    ReqOrSaved::Saved(s) => SavedRequest::Union::Saved(s.clone()),
                    _ => unreachable!(),
                },
                self.resp,
            ),
            deferred_request::HandlerKind::BundledHtmlPage => {
                self.dev
                    .on_html_request_with_bundle(self.route_bundle_index, self.resp, self.req.method());
                Ok(())
            }
        }
    }

    fn on_failure(&mut self) -> JsResult<()> {
        let failure = self
            .dev
            .route_bundle_ptr(self.route_bundle_index)
            .data
            .framework()
            .evaluate_failure
            .as_ref()
            .unwrap();
        let failures = core::slice::from_ref(failure);
        self.dev
            .send_serialized_failures(DevResponse::Http(self.resp), failures, ErrorPageKind::Evaluation, None)
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        self.resp.end("Plugin Error", false);
        Ok(())
    }

    fn to_dev_response(&mut self) -> DevResponse {
        DevResponse::Http(self.resp)
    }
}

#[derive(Copy, Clone)]
enum BundleQueueType {
    NextBundle,
    CurrentBundle,
}

// TODO(port): `ensureRouteIsBundled` is a comptime-generic over `Ctx` with @field
// duck-typing. In Rust we use a trait.
trait EnsureRouteCtx {
    fn on_defer(&mut self, bundle_field: BundleQueueType) -> JsResult<()>;
    fn on_loaded(&mut self) -> JsResult<()>;
    fn on_failure(&mut self) -> JsResult<()>;
    fn on_plugin_error(&mut self) -> JsResult<()>;
    fn to_dev_response(&mut self) -> DevResponse;
    fn dev(&mut self) -> &mut DevServer;
    fn route_bundle_index(&self) -> route_bundle::Index;
}

fn ensure_route_is_bundled<Ctx: EnsureRouteCtx>(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    ctx: &mut Ctx,
) -> JsResult<()> {
    debug_assert!(dev.magic == Magic::Valid);
    debug_assert!(dev.server.is_some());
    let mut state = dev.route_bundle_ptr(route_bundle_index).server_state;
    'sw: loop {
        match state {
            route_bundle::State::Unqueued => {
                // We already are bundling something, defer the request
                if dev.current_bundle.is_some() {
                    dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                    ctx.on_defer(BundleQueueType::NextBundle)?;
                    dev.route_bundle_ptr(route_bundle_index).server_state =
                        route_bundle::State::DeferredToNextBundle;
                    return Ok(());
                }

                // No current bundle, we'll create a bundle with just this route, but first:
                // If plugins are not yet loaded, prepare them.
                let mut plugin = dev.plugin_state;
                'plugin: loop {
                    match plugin {
                        PluginState::Unknown => {
                            if dev.bundler_options.plugin.is_some() {
                                // Framework-provided plugin is likely going to be phased out later
                                dev.plugin_state = PluginState::Loaded;
                            } else {
                                // TODO: implement a proper solution here
                                dev.has_tailwind_plugin_hack =
                                    if let Some(serve_plugins) =
                                        // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                                        unsafe { &(*dev.vm).transpiler.options.serve_plugins }
                                    {
                                        serve_plugins
                                            .iter()
                                            .find(|p| strings::includes(p, b"tailwind"))
                                            .map(|_| Default::default())
                                    } else {
                                        None
                                    };

                                match dev
                                    .server
                                    .as_ref()
                                    .unwrap()
                                    .get_or_load_plugins(jsc::PluginTarget::DevServer(dev))
                                {
                                    jsc::PluginResult::Pending => {
                                        dev.plugin_state = PluginState::Pending;
                                        plugin = PluginState::Pending;
                                        continue 'plugin;
                                    }
                                    jsc::PluginResult::Err => {
                                        dev.plugin_state = PluginState::Err;
                                        plugin = PluginState::Err;
                                        continue 'plugin;
                                    }
                                    jsc::PluginResult::Ready(ready) => {
                                        dev.plugin_state = PluginState::Loaded;
                                        dev.bundler_options.plugin = Some(ready);
                                    }
                                }
                            }
                            break 'plugin;
                        }
                        PluginState::Pending => {
                            dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                            ctx.on_defer(BundleQueueType::NextBundle)?;
                            dev.route_bundle_ptr(route_bundle_index).server_state =
                                route_bundle::State::DeferredToNextBundle;
                            return Ok(());
                        }
                        PluginState::Err => {
                            // TODO: render plugin error page
                            ctx.on_plugin_error()?;
                            return Ok(());
                        }
                        PluginState::Loaded => break 'plugin,
                    }
                }

                // Prepare a bundle with just this route.
                // PERF(port): was stack-fallback alloc
                let mut entry_points = EntryPointList::EMPTY;
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
                ctx.on_defer(BundleQueueType::NextBundle)?;
                dev.route_bundle_ptr(route_bundle_index).server_state = route_bundle::State::Bundling;

                dev.start_async_bundle(
                    entry_points,
                    false,
                    Instant::now(), // TODO(port): std.time.Timer.start()
                )
                .expect("oom");
                return Ok(());
            }
            route_bundle::State::DeferredToNextBundle => {
                debug_assert!(dev.next_bundle.route_queue.get(&route_bundle_index).is_some());
                ctx.on_defer(BundleQueueType::NextBundle)?;
                return Ok(());
            }
            route_bundle::State::Bundling => {
                debug_assert!(dev.current_bundle.is_some());
                ctx.on_defer(BundleQueueType::CurrentBundle)?;
                return Ok(());
            }
            route_bundle::State::PossibleBundlingFailures => {
                if !dev.bundling_failures.is_empty() {
                    // Trace the graph to see if there are any failures that are
                    // reachable by this route.
                    match check_route_failures(dev, route_bundle_index, ctx.to_dev_response())? {
                        CheckResult::Stop => return Ok(()),
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
            route_bundle::State::EvaluationFailure => {
                ctx.on_failure()?;
                return Ok(());
            }
            route_bundle::State::Loaded => {
                ctx.on_loaded()?;
                return Ok(());
            }
        }
    }
}

enum ReqOrSaved {
    Req(*mut Request), // FFI: uws C request ptr from handler callback
    Saved(SavedRequest),
    Aborted, // TODO(port): added for take()-style move; not in Zig
}

impl ReqOrSaved {
    pub fn method(&self) -> Method {
        match self {
            // SAFETY: req is valid for the duration of the handler callback
            ReqOrSaved::Req(req) => Method::which(unsafe { &**req }.method()).unwrap_or(Method::POST),
            ReqOrSaved::Saved(saved) => saved.request.method,
            ReqOrSaved::Aborted => unreachable!(),
        }
    }
}

impl DevServer {
    fn defer_request(
        &mut self,
        requests_array: &mut deferred_request::List,
        route_bundle_index: route_bundle::Index,
        kind: deferred_request::HandlerKind,
        req: ReqOrSaved,
        resp: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        let deferred = self.deferred_request_pool.get();
        debug_log!("DeferredRequest(0x{:x}).init", &deferred.data as *const _ as usize);

        let method = match &req {
            // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
            ReqOrSaved::Req(r) => Method::which(unsafe { &**r }.method()).unwrap_or(Method::GET),
            ReqOrSaved::Saved(saved) => saved.request.method,
            _ => unreachable!(),
        };

        deferred.data = DeferredRequest {
            route_bundle_index,
            dev: self as *const _,
            referenced_by_devserver: true,
            weakly_referenced_by_requestcontext: false,
            handler: match kind {
                deferred_request::HandlerKind::BundledHtmlPage => 'brk: {
                    resp.on_aborted::<DeferredRequest>(DeferredRequest::on_abort, &mut deferred.data);
                    break 'brk Handler::BundledHtmlPage(ResponseAndMethod { response: resp, method });
                }
                deferred_request::HandlerKind::ServerHandler => 'brk: {
                    let server_handler = match req {
                        ReqOrSaved::Req(r) => {
                            // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
                            let global = unsafe { &*(*self.vm).global };
                            match self
                                .server
                                .as_ref()
                                .unwrap()
                                // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
                                .prepare_and_save_js_request_context(unsafe { &mut *r }, resp, global, method)?
                            {
                                Some(h) => h,
                                None => {
                                    self.deferred_request_pool.put(deferred);
                                    return Ok(());
                                }
                            }
                        }
                        ReqOrSaved::Saved(saved) => saved,
                        _ => unreachable!(),
                    };
                    server_handler.ctx.ref_();
                    server_handler.ctx.set_additional_on_abort_callback(
                        jsc::AdditionalOnAbortCallback {
                            cb: DeferredRequest::on_abort_wrapper,
                            data: &mut deferred.data as *mut _ as *mut c_void,
                            deref_fn: {
                                extern "C" fn deref_fn(ptr: *mut c_void) {
                                    // SAFETY: ptr is &mut DeferredRequest from above
                                    let self_: &mut DeferredRequest =
                                        unsafe { &mut *(ptr as *mut DeferredRequest) };
                                    self_.weak_deref();
                                }
                                deref_fn
                            },
                        },
                    );
                    break 'brk Handler::ServerHandler(server_handler);
                }
            },
        };

        if matches!(deferred.data.handler, Handler::ServerHandler(_)) {
            deferred.data.weak_ref();
        }

        requests_array.prepend(deferred);
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
) -> Result<CheckResult, bun_core::Error> {
    // PERF(port): was stack-fallback (65536)
    let mut gts = dev.init_graph_trace_state(0)?;
    let _gts_guard = scopeguard::guard((), |_| {});
    let _failures_guard =
        scopeguard::guard((), |_| dev.incremental_result.failures_added.clear());
    dev.graph_safety_lock.lock();
    let _lock_guard = scopeguard::guard((), |_| dev.graph_safety_lock.unlock());
    // TODO(port): scopeguard borrowing dev — Phase B reshape
    dev.trace_all_route_imports(
        dev.route_bundle_ptr(route_bundle_index),
        &mut gts,
        TraceImportGoal::FindErrors,
    )?;
    if !dev.incremental_result.failures_added.is_empty() {
        // See comment on this field for information
        if !dev.assume_perfect_incremental_bundling {
            // Cache bust EVERYTHING reachable
            // TODO(port): inline for over .{ {graph, bits}, ... } — unrolled
            {
                let mut it = gts.client_bits.iter_ones();
                while let Some(file_index) = it.next() {
                    dev.client_graph.stale_files.set(file_index);
                }
            }
            {
                let mut it = gts.server_bits.iter_ones();
                while let Some(file_index) = it.next() {
                    dev.server_graph.stale_files.set(file_index);
                }
            }
            return Ok(CheckResult::Rebuild);
        }

        dev.send_serialized_failures(
            resp,
            &dev.incremental_result.failures_added,
            ErrorPageKind::Bundler,
            None,
        )?;
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
    ) -> Result<(), AllocError> {
        let server_file_names = self.server_graph.bundled_files.keys();
        let client_file_names = self.client_graph.bundled_files.keys();

        // Build a list of all files that have not yet been bundled.
        match &self.route_bundle_ptr(rbi).data {
            route_bundle::Data::Framework(bundle) => {
                let mut route = self.router.route_ptr(bundle.route_index);
                let router_type = self.router.type_ptr(route.type_);
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    router_type.server_file.into(),
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Client }>(
                    client_file_names,
                    entry_points,
                    router_type.client_file,
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
                while let Some(parent_index) = route.parent.unwrap_() {
                    route = self.router.route_ptr(parent_index);
                    self.append_opaque_entry_point::<{ bake::Side::Server }>(
                        server_file_names,
                        entry_points,
                        route.file_layout,
                    )?;
                }
            }
            route_bundle::Data::Html(html) => {
                entry_points.append(
                    &html.html_bundle.data.bundle.data.path,
                    entry_point_list::Flags { client: true, ..Default::default() },
                )?;
            }
        }

        if let Some(map) = &self.has_tailwind_plugin_hack {
            for abs_path in map.keys() {
                let Some(file) = self.client_graph.bundled_files.get(abs_path) else {
                    continue;
                };
                let file = file.unpack();
                if file.kind() == FileKind::Css {
                    entry_points.append_css(abs_path).expect("oom");
                }
            }
        }
        Ok(())
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    // TODO(port): callconv(jsc.conv) — needs #[bun_jsc::host_call] ABI
    fn Bake__getEnsureAsyncLocalStorageInstanceJSFunction(global: *const JSGlobalObject) -> JSValue;
    fn Bake__getBundleNewRouteJSFunction(global: *const JSGlobalObject) -> JSValue;
    fn Bake__getNewRouteParamsJSFunction(global: *const JSGlobalObject) -> JSValue;
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
    fn compute_arguments_for_framework_request(
        &mut self,
        route_bundle_index: route_bundle::Index,
        framework_bundle: &mut route_bundle::Framework,
        params_js_value: JSValue,
        first_request: bool,
    ) -> JsResult<FrameworkRequestArgs> {
        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*self.vm).global };
        let route_bundle = self.route_bundle_ptr(route_bundle_index);
        let router_type = self
            .router
            .type_ptr(self.router.route_ptr(framework_bundle.route_index).type_);

        Ok(FrameworkRequestArgs {
            // routerTypeMain
            router_type_main: match router_type.server_file_string.get() {
                Some(s) => s,
                None => 'str: {
                    let name = &self.server_graph.bundled_files.keys()
                        [from_opaque_file_id::<{ bake::Side::Server }>(router_type.server_file).get() as usize];
                    let buf = paths::path_buffer_pool().get();
                    let s = BunString::create_utf8_for_js(global, self.relative_path(&mut *buf, name))?;
                    router_type.server_file_string = jsc::StrongOptional::create(s, global);
                    break 'str s;
                }
            },
            // routeModules
            route_modules: match framework_bundle.cached_module_list.get() {
                Some(a) => a,
                None => 'arr: {
                    let keys = self.server_graph.bundled_files.keys();
                    let mut n: usize = 1;
                    let mut route = self.router.route_ptr(framework_bundle.route_index);
                    loop {
                        if route.file_layout != OpaqueFileId::Optional::NONE {
                            n += 1;
                        }
                        let Some(p) = route.parent.unwrap_() else { break };
                        route = self.router.route_ptr(p);
                    }
                    let arr = JSValue::create_empty_array(global, n)?;
                    route = self.router.route_ptr(framework_bundle.route_index);
                    {
                        let buf = paths::path_buffer_pool().get();
                        let mut route_name = BunString::clone_utf8(self.relative_path(
                            &mut *buf,
                            &keys[from_opaque_file_id::<{ bake::Side::Server }>(
                                route.file_page.unwrap_().unwrap(),
                            )
                            .get() as usize],
                        ));
                        arr.put_index(global, 0, route_name.transfer_to_js(global)?)?;
                    }
                    n = 1;
                    loop {
                        if let Some(layout) = route.file_layout.unwrap_() {
                            let buf = paths::path_buffer_pool().get();
                            let mut layout_name = BunString::clone_utf8(self.relative_path(
                                &mut *buf,
                                &keys[from_opaque_file_id::<{ bake::Side::Server }>(layout).get() as usize],
                            ));
                            arr.put_index(global, u32::try_from(n).unwrap(), layout_name.transfer_to_js(global)?)?;
                            n += 1;
                        }
                        let Some(p) = route.parent.unwrap_() else { break };
                        route = self.router.route_ptr(p);
                    }
                    framework_bundle.cached_module_list = jsc::StrongOptional::create(arr, global);
                    break 'arr arr;
                }
            },
            // clientId
            client_id: match framework_bundle.cached_client_bundle_url.get() {
                Some(s) => s,
                None => 'str: {
                    let bundle_index: u32 = route_bundle_index.get();
                    let generation: u32 = route_bundle.client_script_generation;
                    // TODO(port): bun.String.createFormat with raw bytes-as-hex
                    let s = BunString::create_format(format_args!(
                        concat!("/_bun/client", "/route-{:x}{:x}.js"),
                        // TODO(port): Zig used asBytes() (LE-layout hex), not numeric hex
                        bundle_index, generation,
                    ))
                    .expect("oom");
                    let _deref = scopeguard::guard((), |_| s.deref_());
                    let js = s.to_js(global)?;
                    framework_bundle.cached_client_bundle_url = jsc::StrongOptional::create(js, global);
                    break 'str js;
                }
            },
            // styles
            styles: match framework_bundle.cached_css_file_array.get() {
                Some(a) => a,
                None => 'arr: {
                    let js = self.generate_css_js_array(route_bundle)?;
                    framework_bundle.cached_css_file_array = jsc::StrongOptional::create(js, global);
                    break 'arr js;
                }
            },
            // params
            params: params_js_value,

            // setAsyncLocalStorage
            set_async_local_storage: if first_request {
                // SAFETY: extern "C" FFI; global is a valid &JSGlobalObject
                unsafe { Bake__getEnsureAsyncLocalStorageInstanceJSFunction(global) }
            } else {
                JSValue::NULL
            },
            bundle_new_route: if first_request {
                // SAFETY: extern "C" FFI; global is a valid &JSGlobalObject
                unsafe { Bake__getBundleNewRouteJSFunction(global) }
            } else {
                JSValue::NULL
            },
            new_route_params: if first_request {
                // SAFETY: extern "C" FFI; global is a valid &JSGlobalObject
                unsafe { Bake__getNewRouteParamsJSFunction(global) }
            } else {
                JSValue::NULL
            },
        })
    }

    fn on_framework_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        req: SavedRequest::Union,
        resp: AnyResponse,
    ) -> JsResult<()> {
        let route_bundle = self.route_bundle_ptr(route_bundle_index);
        debug_assert!(matches!(route_bundle.data, route_bundle::Data::Framework(_)));

        let framework_bundle = route_bundle.data.framework_mut();

        // Extract route params by re-matching the URL
        let mut params: framework_router::MatchedParams = Default::default();
        let url_bunstr = match &req {
            SavedRequest::Union::Stack(r) => BunString {
                tag: BunString::Tag::ZigString,
                // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
                value: BunString::Value::ZigString(str::ZigString::from_utf8(unsafe { &**r }.url())),
            },
            SavedRequest::Union::Saved(data) => 'brk: {
                let url = data.request.url.clone();
                url.ref_();
                break 'brk url;
            }
        };
        let _deref = scopeguard::guard((), |_| url_bunstr.deref_());
        let url = url_bunstr.to_utf8();

        // Extract pathname from URL (remove protocol, host, query, hash)
        let pathname = extract_pathname_from_url(url.byte_slice());

        // Create params JSValue
        // TODO: lazy structure caching since we are making these objects a lot
        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*self.vm).global };
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
            framework_bundle,
            params_js_value,
            true,
        )?;

        self.server.as_ref().unwrap().on_saved_request(
            req,
            resp,
            server_request_callback,
            8,
            &[
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
        Ok(())
    }

    fn on_html_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        let route_bundle = self.route_bundle_ptr(route_bundle_index);
        debug_assert!(matches!(route_bundle.data, route_bundle::Data::Html(_)));
        let html = route_bundle.data.html_mut();

        let blob = match &html.cached_response {
            Some(b) => b,
            None => 'generate: {
                let payload =
                    self.generate_html_payload(route_bundle_index, route_bundle, html).expect("oom");

                html.cached_response = Some(StaticRoute::init_from_any_blob(
                    &Blob::Any::from_owned_slice(payload),
                    StaticRoute::Options {
                        mime_type: &MimeType::HTML,
                        server: self.server.unwrap(),
                        ..Default::default()
                    },
                ));
                break 'generate html.cached_response.as_ref().unwrap();
            }
        };
        blob.on_with_method(method, resp);
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
        route_bundle: &mut RouteBundle,
        html: &mut route_bundle::HTML,
    ) -> Result<Vec<u8>, AllocError> {
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
        debug_assert!(html.html_bundle.data.dev_server_id.unwrap_() == Some(route_bundle_index));
        debug_assert!(html.cached_response.is_none());
        let script_injection_offset = html.script_injection_offset.unwrap_().unwrap().get() as usize;
        let bundled_html = html.bundled_html_text.as_ref().unwrap();

        // The bundler records an offsets in development mode, splitting the HTML
        // file into two chunks. DevServer is able to insert style/script tags
        // using the information available in IncrementalGraph.
        let before_head_end = &bundled_html[..script_injection_offset];
        let after_head_end = &bundled_html[script_injection_offset..];

        let mut display_name = strings::without_suffix(
            paths::basename(&html.html_bundle.data.bundle.data.path),
            b".html",
        );
        // TODO: function for URL safe chars
        if !strings::is_all_ascii(display_name) {
            display_name = b"page";
        }

        self.graph_safety_lock.lock();
        let _lock = scopeguard::guard((), |_| self.graph_safety_lock.unlock());
        // TODO(port): scopeguard borrow conflict — Phase B reshape

        // Prepare bitsets for tracing
        // PERF(port): was stack-fallback (65536)
        let mut gts = self.init_graph_trace_state(0)?;
        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindCss)?;

        let css_ids = &self.client_graph.current_css_files;

        let payload_size = bundled_html.len()
            + ("<link rel=\"stylesheet\" href=\"".len() + ASSET_PREFIX.len() + "/0000000000000000.css\">".len())
                * css_ids.len()
            + "<script type=\"module\" crossorigin src=\"\" data-bun-dev-server-script></script>".len()
            + CLIENT_PREFIX.len()
            + "/".len()
            + display_name.len()
            + "-0000000000000000.js".len()
            + SCRIPT_UNREF_PAYLOAD.len();

        let mut array: Vec<u8> = Vec::with_capacity(payload_size);
        // PERF(port): was appendSliceAssumeCapacity throughout
        array.extend_from_slice(before_head_end);

        // Insert all link tags before "</head>"
        for name in css_ids {
            array.extend_from_slice(b"<link rel=\"stylesheet\" href=\"");
            array.extend_from_slice(ASSET_PREFIX.as_bytes());
            array.extend_from_slice(b"/");
            array.extend_from_slice(&bun_core::fmt::bytes_to_hex_lower(&name.to_ne_bytes()));
            array.extend_from_slice(b".css\">");
        }

        array.extend_from_slice(b"<script type=\"module\" crossorigin src=\"");
        array.extend_from_slice(CLIENT_PREFIX.as_bytes());
        array.extend_from_slice(b"/");
        array.extend_from_slice(display_name);
        array.extend_from_slice(b"-");
        array.extend_from_slice(&bun_core::fmt::bytes_to_hex_lower(
            &(route_bundle_index.get() as u32).to_ne_bytes(),
        ));
        array.extend_from_slice(&bun_core::fmt::bytes_to_hex_lower(
            &route_bundle.client_script_generation.to_ne_bytes(),
        ));
        array.extend_from_slice(b".js\" data-bun-dev-server-script></script>");
        array.extend_from_slice(SCRIPT_UNREF_PAYLOAD.as_bytes());

        // DevServer used to put the script tag before the body end, but to match the regular bundler it does not do this.
        array.extend_from_slice(after_head_end);
        debug_assert!(array.len() == array.capacity()); // incorrect memory allocation size
        Ok(array)
    }

    fn generate_javascript_code_for_html_file(
        &mut self,
        index: bun_js_parser::ast::Index,
        import_records: &[bun_collections::BabyList<ImportRecord>],
        input_file_sources: &[bun_logger::Source],
        loaders: &[Loader],
    ) -> Result<Box<[u8]>, AllocError> {
        // PERF(port): was stack-fallback (65536)
        let mut array: Vec<u8> = Vec::with_capacity(65536);
        let w = &mut array;

        w.extend_from_slice(b"  ");
        bun_js_printer::write_json_string(
            &input_file_sources[index.get() as usize].path.pretty,
            w,
            bun_js_printer::Encoding::Utf8,
        )?;
        w.extend_from_slice(b": [ [");
        let mut any = false;
        for import in import_records[index.get() as usize].slice() {
            if import.source_index.is_valid() {
                if !loaders[import.source_index.get() as usize].is_javascript_like() {
                    continue; // ignore non-JavaScript imports
                }
            } else {
                // Find the in-graph import.
                let Some(file) = self.client_graph.bundled_files.get(&import.path.text) else {
                    continue;
                };
                let file = file.unpack();
                if !matches!(file.content, incremental_graph::Content::Js(_)) {
                    continue;
                }
            }
            if !any {
                any = true;
                w.extend_from_slice(b"\n");
            }
            w.extend_from_slice(b"    ");
            bun_js_printer::write_json_string(&import.path.pretty, w, bun_js_printer::Encoding::Utf8)?;
            w.extend_from_slice(b", 0,\n");
        }
        if any {
            w.extend_from_slice(b"  ");
        }
        w.extend_from_slice(b"], [], [], () => {}, false],\n");

        // Avoid-recloning if it is was moved to the heap
        // PERF(port): Zig checked if buffer was on stack vs heap; Vec always heap
        Ok(array.into_boxed_slice())
    }

    pub fn on_js_request_with_bundle(
        &mut self,
        bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        let route_bundle = self.route_bundle_ptr(bundle_index);
        let client_bundle = match &route_bundle.client_bundle {
            Some(cb) => cb,
            None => 'generate: {
                let payload = self.generate_client_bundle(route_bundle).expect("oom");
                route_bundle.client_bundle = Some(StaticRoute::init_from_any_blob(
                    &Blob::Any::from_owned_slice(payload),
                    StaticRoute::Options {
                        mime_type: &MimeType::JAVASCRIPT,
                        server: self.server.unwrap(),
                        ..Default::default()
                    },
                ));
                break 'generate route_bundle.client_bundle.as_ref().unwrap();
            }
        };
        self.source_maps.add_weak_ref(route_bundle.source_map_id());
        client_bundle.on_with_method(method, resp);
    }

    pub fn on_src_request<R>(&mut self, req: &mut Request, resp: &mut R)
    where
        R: uws::ResponseLike, // TODO(port): resp: anytype
    {
        if req.header("open-in-editor").is_none() {
            resp.write_status("501 Not Implemented");
            resp.end(
                "Viewing source without opening in editor is not implemented yet!",
                false,
            );
            return;
        }

        // TODO: better editor detection. on chloe's dev env, this opens apple terminal + vim
        // This is already done in Next.js. we have to port this to Zig so we can use.
        resp.write_status("501 Not Implemented");
        resp.end("TODO", false);
        let _ = self;
    }
}

pub enum DevResponse {
    Http(AnyResponse),
    Promise(PromiseResponse),
}

/// When requests are waiting on a bundle, the relevant request information is
/// prepared and stored in a linked list.
pub struct DeferredRequest {
    pub route_bundle_index: route_bundle::Index,
    pub handler: Handler,
    pub dev: *const DevServer, // BACKREF: owned by dev.deferred_request_pool

    /// This struct can be referenced by the dev server (`dev.current_bundle.requests`)
    pub referenced_by_devserver: bool,
    pub weakly_referenced_by_requestcontext: bool,
}

pub mod deferred_request {
    use super::*;

    /// A small maximum is set because development servers are unlikely to
    /// acquire much load, so allocating a ton at the start for no reason
    /// is very silly. This contributes to ~6kb of the initial DevServer allocation.
    pub const MAX_PREALLOCATED: usize = 16;

    pub type List = bun_collections::SinglyLinkedList<DeferredRequest>;
    pub type Node = bun_collections::SinglyLinkedListNode<DeferredRequest>;

    bun_output::declare_scope!(DlogeferredRequest, hidden);
    macro_rules! debug_log_dr { ($($t:tt)*) => { bun_output::scoped_log!(DlogeferredRequest, $($t)*) }; }
    pub(super) use debug_log_dr;

    /// Sometimes we will call `await bundleNewRoute()` and this will either
    /// resolve with the args for the route, or reject with data
    pub struct PromiseResponse<'a> {
        pub promise: jsc::JSPromiseStrong,
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
use deferred_request::{Handler, PromiseResponse};

impl DeferredRequest {
    pub const MAX_PREALLOCATED: usize = deferred_request::MAX_PREALLOCATED;

    pub fn is_alive(&self) -> bool {
        self.referenced_by_devserver
    }

    // NOTE: This should only be called from the DevServer which is the only
    // place that can hold a strong reference
    pub fn deref_(&mut self) {
        self.referenced_by_devserver = false;
        let should_free = !self.weakly_referenced_by_requestcontext;
        self.__deinit();
        if should_free {
            self.__free();
        }
    }

    pub fn weak_ref(&mut self) {
        debug_assert!(!self.weakly_referenced_by_requestcontext);
        self.weakly_referenced_by_requestcontext = true;
    }

    pub fn weak_deref(&mut self) {
        self.weakly_referenced_by_requestcontext = false;
        if !self.referenced_by_devserver {
            self.__free();
        }
    }

    extern "C" fn on_abort_wrapper(this: *mut c_void) {
        // SAFETY: this is &mut DeferredRequest registered in defer_request
        let self_ = unsafe { &mut *(this as *mut DeferredRequest) };
        if !self_.is_alive() {
            return;
        }
        self_.on_abort_impl();
    }

    fn on_abort(&mut self, _: AnyResponse) {
        self.on_abort_impl();
    }

    fn on_abort_impl(&mut self) {
        deferred_request::debug_log_dr!("DeferredRequest(0x{:x}) onAbort", self as *const _ as usize);
        self.abort();
        debug_assert!(matches!(self.handler, Handler::Aborted));
    }

    /// Actually free the underlying allocation for the node, does not deinitialize children
    fn __free(&mut self) {
        // SAFETY: self is the .data field of a Node in deferred_request_pool
        let node = unsafe {
            &mut *((self as *mut _ as *mut u8).sub(offset_of!(deferred_request::Node, data))
                as *mut deferred_request::Node)
        };
        // SAFETY: dev backref is valid while the pool entry exists
        unsafe { &mut *(self.dev as *mut DevServer) }
            .deferred_request_pool
            .put(node);
    }

    /// *WARNING*: Do not call this directly, instead call `.deref_()`
    fn __deinit(&mut self) {
        deferred_request::debug_log_dr!("DeferredRequest(0x{:x}) deinitImpl", self as *const _ as usize);
        match &mut self.handler {
            Handler::ServerHandler(saved) => saved.deinit(),
            Handler::BundledHtmlPage(_) | Handler::Aborted => {}
        }
    }

    /// Deinitializes state by aborting the connection.
    fn abort(&mut self) {
        deferred_request::debug_log_dr!("DeferredRequest(0x{:x}) abort", self as *const _ as usize);
        let handler = core::mem::replace(&mut self.handler, Handler::Aborted);
        match handler {
            Handler::ServerHandler(mut saved) => {
                deferred_request::debug_log_dr!(
                    "  request url: {}",
                    bstr::BStr::new(saved.request.url.byte_slice())
                );
                saved.ctx.set_signal_aborted(jsc::AbortReason::ConnectionClosed);
                saved.js_request.deinit();
            }
            Handler::BundledHtmlPage(r) => {
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
    pub fn start_async_bundle(
        &mut self,
        entry_points: EntryPointList,
        had_reload_event: bool,
        timer: Instant,
    ) -> Result<(), AllocError> {
        debug_assert!(self.current_bundle.is_none());
        debug_assert!(!entry_points.set.is_empty());
        self.log.clear_and_free();

        // Notify inspector about bundle start
        if let Some(agent) = self.inspector() {
            // PERF(port): was stack-fallback
            let mut trigger_files: Vec<BunString> = Vec::with_capacity(entry_points.set.len());
            for key in entry_points.set.keys() {
                trigger_files.push(BunString::clone_utf8(key));
            }
            agent.notify_bundle_start(self.inspector_server_id, &trigger_files);
            for s in &mut trigger_files {
                s.deref_();
            }
        }

        self.incremental_result.reset();

        // Ref server to keep it from closing.
        if let Some(server) = &self.server {
            server.on_pending_request();
        }

        let mut heap = bun_alloc::MimallocArena::init();
        // TODO(port): heap is moved into BundleV2; errdefer heap.deinit() handled by Drop
        let alloc = heap.allocator();
        // TODO(port): ASTMemoryAllocator scope — bake is an AST crate; arena threading required
        let ast_memory_allocator = alloc.alloc(bun_js_parser::ASTMemoryAllocator::default());
        let _ast_scope = ast_memory_allocator.enter(alloc);

        let bv2 = BundleV2::init(
            &mut self.server_transpiler,
            bundler::BakeOptions {
                framework: self.framework.clone(),
                client_transpiler: &mut self.client_transpiler,
                ssr_transpiler: &mut self.ssr_transpiler,
                plugins: self.bundler_options.plugin.clone(),
            },
            alloc,
            // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
            bundler::EventLoop::Js(unsafe { &*self.vm }.event_loop()),
            false, // watching is handled separately
            bun_threading::WorkPool::get(),
            heap,
        )?;
        bv2.bun_watcher = Some(&mut *self.bun_watcher);
        bv2.asynchronous = true;

        {
            self.graph_safety_lock.lock();
            let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());
            self.client_graph.reset();
            self.server_graph.reset();
        }

        let start_data = bv2.start_from_bake_dev_server(&entry_points)?;
        self.current_bundle = Some(CurrentBundle {
            bv2,
            timer,
            start_data,
            had_reload_event,
            requests: core::mem::take(&mut self.next_bundle.requests),
            promise: core::mem::take(&mut self.next_bundle.promise),
            resolution_failure_entries: Default::default(),
        });

        self.next_bundle.promise = DeferredPromise::default();
        self.next_bundle.requests = deferred_request::List::default();
        self.next_bundle.route_queue.clear();
        Ok(())
    }

    pub fn prepare_and_log_resolution_failures(&mut self) -> Result<(), bun_core::Error> {
        // Since resolution failures can be asynchronous, their logs are not inserted
        // until the very end.
        let resolution_failures = &self.current_bundle.as_ref().unwrap().resolution_failure_entries;
        if !resolution_failures.is_empty() {
            for (owner, log) in resolution_failures.keys().iter().zip(resolution_failures.values()) {
                if log.has_errors() {
                    match owner.decode() {
                        serialized_failure::Owner::Client(index) => {
                            self.client_graph
                                .insert_failure(incremental_graph::FailureKey::Index, index, log, false)?
                        }
                        serialized_failure::Owner::Server(index) => {
                            self.server_graph
                                .insert_failure(incremental_graph::FailureKey::Index, index, log, true)?
                        }
                        serialized_failure::Owner::None | serialized_failure::Owner::Route(_) => {
                            unreachable!()
                        }
                    }
                }
            }
        }

        // Theoretically, it shouldn't be possible for errors to leak into dev.log
        if self.log.has_errors() && !self.log.msgs.is_empty() {
            if cfg!(debug_assertions) {
                Output::debug_warn("dev.log should not be written into when using DevServer");
            }
            let _ = self.log.print(Output::error_writer());
        }
        Ok(())
    }

    fn index_failures(&mut self) -> Result<(), bun_core::Error> {
        // After inserting failures into the IncrementalGraphs, they are traced to their routes.
        // PERF(port): was stack-fallback (65536)

        if !self.incremental_result.failures_added.is_empty() {
            let mut total_len: usize =
                core::mem::size_of::<MessageId>() + core::mem::size_of::<u32>();

            for fail in &self.incremental_result.failures_added {
                total_len += fail.data.len();
            }

            total_len += self.incremental_result.failures_removed.len() * core::mem::size_of::<u32>();

            let mut gts = self.init_graph_trace_state(0)?;

            let mut payload: Vec<u8> = Vec::with_capacity(total_len);
            payload.push(MessageId::Errors.char());
            // PERF(port): was assume_capacity

            payload.extend_from_slice(
                &u32::try_from(self.incremental_result.failures_removed.len())
                    .unwrap()
                    .to_le_bytes(),
            );

            for removed in &self.incremental_result.failures_removed {
                payload.extend_from_slice(
                    // SAFETY: encode() returns a #[repr(transparent)] u32 wrapper (@bitCast in Zig)
                    &unsafe { core::mem::transmute::<_, u32>(removed.get_owner().encode()) }.to_le_bytes(),
                );
                removed.deinit(self);
            }

            for added in &self.incremental_result.failures_added {
                payload.extend_from_slice(&added.data);

                match added.get_owner() {
                    serialized_failure::Owner::None | serialized_failure::Owner::Route(_) => {
                        unreachable!()
                    }
                    serialized_failure::Owner::Server(index) => self
                        .server_graph
                        .trace_dependencies(index, &mut gts, incremental_graph::TraceStop::NoStop, index)?,
                    serialized_failure::Owner::Client(index) => self
                        .client_graph
                        .trace_dependencies(index, &mut gts, incremental_graph::TraceStop::NoStop, index)?,
                }
            }

            for entry in &self.incremental_result.framework_routes_affected {
                if let Some(index) = self.router.route_ptr(entry.route_index).bundle.unwrap_() {
                    self.route_bundle_ptr(index).server_state =
                        route_bundle::State::PossibleBundlingFailures;
                }
                if entry.should_recurse_when_visiting {
                    self.mark_all_route_children_failed(entry.route_index);
                }
            }

            for index in &self.incremental_result.html_routes_soft_affected {
                self.route_bundle_ptr(*index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }

            for index in &self.incremental_result.html_routes_hard_affected {
                self.route_bundle_ptr(*index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::Binary);
        } else if !self.incremental_result.failures_removed.is_empty() {
            let mut payload: Vec<u8> = Vec::with_capacity(
                core::mem::size_of::<MessageId>()
                    + core::mem::size_of::<u32>()
                    + self.incremental_result.failures_removed.len() * core::mem::size_of::<u32>(),
            );
            payload.push(MessageId::Errors.char());

            payload.extend_from_slice(
                &u32::try_from(self.incremental_result.failures_removed.len())
                    .unwrap()
                    .to_le_bytes(),
            );

            for removed in &self.incremental_result.failures_removed {
                payload.extend_from_slice(
                    // SAFETY: encode() returns a #[repr(transparent)] u32 wrapper (@bitCast in Zig)
                    &unsafe { core::mem::transmute::<_, u32>(removed.get_owner().encode()) }.to_le_bytes(),
                );
                removed.deinit(self);
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::Binary);
        }

        self.incremental_result.failures_removed.clear();
        Ok(())
    }

    /// Used to generate the entry point. Unlike incremental patches, this always
    /// contains all needed files for a route.
    fn generate_client_bundle(&mut self, route_bundle: &mut RouteBundle) -> Result<Vec<u8>, AllocError> {
        debug_assert!(route_bundle.client_bundle.is_none());
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);

        self.graph_safety_lock.lock();
        let _lock = scopeguard::guard((), |_| self.graph_safety_lock.unlock());

        // Prepare bitsets
        // PERF(port): was stack-fallback (65536)
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        // `current_chunk_parts`/`current_chunk_len` are scratch buffers shared with
        // the HMR pipeline. We must leave them cleared on every exit path.
        let _reset = scopeguard::guard((), |_| self.client_graph.reset());
        // TODO(port): scopeguard borrow conflict
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindClientModules)?;

        let mut react_fast_refresh_id: &[u8] = b"";
        if let Some(rfr) = &self.framework.react_fast_refresh {
            'brk: {
                let Some(rfr_index) = self.client_graph.get_file_index(&rfr.import_source) else {
                    break 'brk;
                };
                if !self.client_graph.stale_files.is_set(rfr_index.get() as usize) {
                    self.client_graph
                        .trace_imports(rfr_index, &mut gts, TraceImportGoal::FindClientModules)?;
                    react_fast_refresh_id = &rfr.import_source;
                }
            }
        }

        let client_file: Option<incremental_graph::ClientFileIndex> = match &route_bundle.data {
            route_bundle::Data::Framework(fw) => self
                .router
                .type_ptr(self.router.route_ptr(fw.route_index).type_)
                .client_file
                .unwrap_()
                .map(|ofi| from_opaque_file_id::<{ bake::Side::Client }>(ofi)),
            route_bundle::Data::Html(html) => Some(html.bundled_file),
        };

        // Insert the source map
        let script_id = route_bundle.source_map_id();
        map_log!("inc {:x}, 1 for generateClientBundle", script_id.get());
        match self.source_maps.put_or_increment_ref_count(script_id, 1)? {
            source_map_store::PutResult::Uninitialized(entry) => {
                let _guard = scopeguard::guard((), |_| self.source_maps.unref(script_id));
                // TODO(port): errdefer — disarm on success
                gts.clear_and_free();
                // PERF(port): was ArenaAllocator
                self.client_graph.take_source_map(entry)?;
                core::mem::forget(_guard);
            }
            source_map_store::PutResult::Shared(_) => {}
        }

        let client_bundle = self.client_graph.take_js_bundle(&incremental_graph::TakeOptions {
            kind: ChunkKind::InitialResponse,
            initial_response_entry_point: if let Some(index) = client_file {
                &self.client_graph.bundled_files.keys()[index.get() as usize]
            } else {
                b""
            },
            react_refresh_entry_point: react_fast_refresh_id,
            script_id,
            console_log: self.should_receive_console_log_from_browser(),
        });

        Ok(client_bundle)
    }

    fn generate_css_js_array(&mut self, route_bundle: &mut RouteBundle) -> JsResult<JSValue> {
        debug_assert!(matches!(route_bundle.data, route_bundle::Data::Framework(_)));
        if cfg!(debug_assertions) {
            debug_assert!(!route_bundle.data.framework().cached_css_file_array.has());
        }
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);

        self.graph_safety_lock.lock();
        let _lock = scopeguard::guard((), |_| self.graph_safety_lock.unlock());

        // Prepare bitsets
        // PERF(port): was stack-fallback (65536)
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindCss)?;

        let names = &self.client_graph.current_css_files;
        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*self.vm).global };
        let arr = jsc::JSArray::create_empty(global, names.len())?;
        for (i, item) in names.iter().enumerate() {
            let mut buf = [0u8; ASSET_PREFIX.len() + core::mem::size_of::<u64>() * 2 + "/.css".len()];
            let path = {
                let mut cursor = &mut buf[..];
                write!(
                    cursor,
                    "{}/{}.css",
                    ASSET_PREFIX,
                    bstr::BStr::new(&bun_core::fmt::bytes_to_hex_lower(&item.to_ne_bytes())),
                )
                .expect("unreachable");
                let written = buf.len() - cursor.len();
                &buf[..written]
            };
            let s = BunString::clone_utf8(path);
            let _deref = scopeguard::guard((), |_| s.deref_());
            arr.put_index(global, u32::try_from(i).unwrap(), s.to_js(global)?)?;
        }
        Ok(arr)
    }

    // PERF(port): was comptime monomorphization (`comptime goal: TraceImportGoal`) — profile in Phase B
    fn trace_all_route_imports(
        &mut self,
        route_bundle: &RouteBundle,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> Result<(), bun_core::Error> {
        match &route_bundle.data {
            route_bundle::Data::Framework(fw) => {
                let mut route = self.router.route_ptr(fw.route_index);
                let router_type = self.router.type_ptr(route.type_);

                // Both framework entry points are considered
                self.server_graph.trace_imports(
                    from_opaque_file_id::<{ bake::Side::Server }>(router_type.server_file),
                    gts,
                    TraceImportGoal::FindCss,
                )?;
                if let Some(id) = router_type.client_file.unwrap_() {
                    self.client_graph.trace_imports(
                        from_opaque_file_id::<{ bake::Side::Client }>(id),
                        gts,
                        goal,
                    )?;
                }

                // The route file is considered
                if let Some(id) = route.file_page.unwrap_() {
                    self.server_graph
                        .trace_imports(from_opaque_file_id::<{ bake::Side::Server }>(id), gts, goal)?;
                }

                // For all parents, the layout is considered
                loop {
                    if let Some(id) = route.file_layout.unwrap_() {
                        self.server_graph.trace_imports(
                            from_opaque_file_id::<{ bake::Side::Server }>(id),
                            gts,
                            goal,
                        )?;
                    }
                    let Some(p) = route.parent.unwrap_() else { break };
                    route = self.router.route_ptr(p);
                }
            }
            route_bundle::Data::Html(html) => {
                self.client_graph.trace_imports(html.bundled_file, gts, goal)?;
            }
        }
        Ok(())
    }

    fn make_array_for_server_components_patch(
        &mut self,
        global: &JSGlobalObject,
        items: &[incremental_graph::ServerFileIndex],
    ) -> JsResult<JSValue> {
        if items.is_empty() {
            return Ok(JSValue::NULL);
        }
        let arr = jsc::JSArray::create_empty(global, items.len())?;
        let names = self.server_graph.bundled_files.keys();
        for (i, item) in items.iter().enumerate() {
            let buf = paths::path_buffer_pool().get();
            let s = BunString::clone_utf8(self.relative_path(&mut *buf, &names[item.get() as usize]));
            let _deref = scopeguard::guard((), |_| s.deref_());
            arr.put_index(global, u32::try_from(i).unwrap(), s.to_js(global)?)?;
        }
        Ok(arr)
    }
}

pub struct HotUpdateContext<'a> {
    /// bundle_v2.Graph.input_files.items(.source)
    pub sources: &'a [bun_logger::Source],
    /// bundle_v2.Graph.ast.items(.import_records)
    pub import_records: &'a [bun_collections::BabyList<ImportRecord>],
    /// bundle_v2.Graph.server_component_boundaries.slice()
    pub scbs: bun_js_parser::ast::ServerComponentBoundaryListSlice<'a>,
    /// bundle_v2.Graph.input_files.items(.loader)
    pub loaders: &'a [Loader],
    /// Which files have a server-component boundary.
    pub server_to_client_bitset: DynamicBitSet,
    /// Used to reduce calls to the IncrementalGraph hash table.
    /// First half is for client graph, second half for server.
    pub resolved_index_cache: &'a mut [u32],
    /// Used to tell if the server should replace or append import records.
    pub server_seen_bit_set: DynamicBitSet,
    pub gts: &'a mut GraphTraceState,
}

impl<'a> HotUpdateContext<'a> {
    pub fn get_cached_index<const SIDE: bake::Side>(
        &self,
        i: bun_js_parser::ast::Index,
    ) -> &mut incremental_graph::FileIndexOptional<SIDE> {
        let start = match SIDE {
            bake::Side::Client => 0,
            bake::Side::Server => self.sources.len(),
        };

        let subslice = &self.resolved_index_cache[start..][..self.sources.len()];

        const _: () = assert!(
            core::mem::align_of::<incremental_graph::FileIndexOptional<{ bake::Side::Client }>>()
                == core::mem::align_of::<u32>()
        );
        const _: () = assert!(
            core::mem::size_of::<incremental_graph::FileIndexOptional<{ bake::Side::Client }>>()
                == core::mem::size_of::<u32>()
        );
        // SAFETY: FileIndexOptional is repr(transparent) over u32
        unsafe { &mut *(&subslice[i.get() as usize] as *const u32 as *mut _) }
    }
}

/// Called at the end of BundleV2 to index bundle contents into the `IncrementalGraph`s
/// This function does not recover DevServer state if it fails (allocation failure)
pub fn finalize_bundle(
    dev: &mut DevServer,
    bv2: &mut BundleV2,
    result: &bundler::DevServerOutput,
) -> JsResult<()> {
    debug_assert!(dev.magic == Magic::Valid);
    let mut had_sent_hmr_event = false;

    // TODO(port): the giant `defer` block at the start of finalizeBundle has been
    // moved into a scopeguard. Phase B must verify ordering relative to ?-returns.
    let dev_ptr = dev as *mut DevServer;
    let _outer_defer = scopeguard::guard((), |_| {
        // SAFETY: dev outlives this scope
        let dev = unsafe { &mut *dev_ptr };
        let mut heap = bv2.graph.heap.take(); // TODO(port): heap moved out before deinit
        bv2.deinit_without_freeing_arena();
        if let Some(cb) = &mut dev.current_bundle {
            cb.promise.deinit_idempotently();
        }
        dev.current_bundle = None;
        dev.log.clear_and_free();
        drop(heap);

        let _ = dev.assets.reindex_if_needed(); // not fatal

        // Signal for testing framework where it is in synchronization
        if matches!(dev.testing_batch_events, TestingBatchEvents::EnableAfterBundle) {
            dev.testing_batch_events = TestingBatchEvents::Enabled(TestingBatch::EMPTY);
            dev.publish(
                HmrTopic::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 0],
                Opcode::Binary,
            );
        } else {
            dev.publish(
                HmrTopic::TestingWatchSynchronization,
                &[
                    MessageId::TestingWatchSynchronization.char(),
                    if had_sent_hmr_event { 4 } else { 3 },
                ],
                Opcode::Binary,
            );
        }

        dev.start_next_bundle_if_present();

        // Unref the ref added in `start_async_bundle`
        if let Some(server) = &dev.server {
            server.on_static_request_complete();
        }
    });

    let current_bundle = dev.current_bundle.as_mut().unwrap();
    let current_bundle_ptr = current_bundle as *mut CurrentBundle;
    let _requests_defer = scopeguard::guard((), |_| {
        // SAFETY: current_bundle outlives this scope
        let current_bundle = unsafe { &mut *current_bundle_ptr };
        if current_bundle.requests.first.is_some() {
            // cannot be an assertion because in the case of OOM, the request list was not drained.
            Output::debug(
                "current_bundle.requests.first != null. this leaves pending requests without an error page!",
            );
        }
        while let Some(node) = current_bundle.requests.pop_first() {
            let req = &mut node.data;
            req.abort();
            req.deref_();
        }
    });

    dev.graph_safety_lock.lock();
    let _lock = scopeguard::guard((), |_| dev.graph_safety_lock.unlock());

    let js_chunk = result.js_pseudo_chunk();
    let input_file_sources = bv2.graph.input_files.items_source();
    let input_file_loaders = bv2.graph.input_files.items_loader();
    let import_records = bv2.graph.ast.items_import_records();
    let targets = bv2.graph.ast.items_target();
    let scbs = bv2.graph.server_component_boundaries.slice();

    // PERF(port): was stack-fallback (65536) on bv2.allocator()
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
        if (*ssr_index as usize) < scb_bitset.bit_length() {
            scb_bitset.set(*ssr_index as usize);
        }
    }

    let mut resolved_index_cache = vec![
        incremental_graph::FileIndexOptional::<{ bake::Side::Server }>::NONE.raw();
        input_file_sources.len() * 2
    ];

    // TODO(port): ctx fields server_seen_bit_set/gts were `undefined` then assigned later.
    let mut gts_storage = dev.init_graph_trace_state(
        if !result.css_chunks().is_empty() { bv2.graph.input_files.len() } else { 0 },
    )?;
    let mut ctx = HotUpdateContext {
        import_records,
        sources: input_file_sources,
        loaders: input_file_loaders,
        scbs,
        server_to_client_bitset: scb_bitset,
        resolved_index_cache: &mut resolved_index_cache,
        server_seen_bit_set: DynamicBitSet::default(), // assigned below
        gts: &mut gts_storage,
    };

    let quoted_source_contents = bv2.linker.graph.files.items_quoted_source_contents();
    // Pass 1, update the graph's nodes, resolving every bundler source
    // index into its `IncrementalGraph(...).FileIndex`
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
        let source_map: SourceMap::Chunk = match compile_result.source_map_chunk() {
            Some(c) => c,
            None => 'brk: {
                // The source map is `null` if empty
                debug_assert!(matches!(compile_result.javascript().result, bundler::JsResult::Result(_)));
                debug_assert!(dev.server_transpiler.options.source_map != bundler::SourceMapOption::None);
                debug_assert!(!part_range.source_index.is_runtime());
                break 'brk SourceMap::Chunk::init_empty();
            }
        };
        let quoted_contents = &quoted_source_contents[part_range.source_index.get() as usize];
        match targets[part_range.source_index.get() as usize].bake_graph() {
            bake::Graph::Client => dev.client_graph.receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ChunkContent::Js(incremental_graph::JsChunk {
                    code: compile_result.javascript().code(),
                    source_map: Some(incremental_graph::SourceMapData {
                        chunk: source_map,
                        escaped_source: quoted_contents,
                    }),
                }),
                false,
            )?,
            graph @ (bake::Graph::Server | bake::Graph::Ssr) => dev.server_graph.receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ChunkContent::Js(incremental_graph::JsChunk {
                    code: compile_result.javascript().code(),
                    source_map: Some(incremental_graph::SourceMapData {
                        chunk: source_map,
                        escaped_source: quoted_contents,
                    }),
                }),
                graph == bake::Graph::Ssr,
            )?,
        }
    }

    for (chunk, metadata) in result.css_chunks().iter_mut().zip(result.css_file_list.values()) {
        debug_assert!(matches!(chunk.content, bundler::ChunkContent::Css(_)));

        let index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index);

        let code = chunk.intermediate_output.code(
            &bv2.graph,
            &bv2.linker.graph,
            "THIS_SHOULD_NEVER_BE_EMITTED_IN_DEV_MODE",
            chunk,
            result.chunks(),
            None,
            false,
            false,
        )?;

        // Create an entry for this file.
        let key = ctx.sources[index.get() as usize].path.key_for_incremental_graph();
        // TODO: use a hash mix with the first half being a path hash and the second half content hash
        let h = hash(key);
        let asset_index = dev.assets.replace_path(
            key,
            &Blob::Any::from_owned_slice(code.buffer.into()),
            &MimeType::CSS,
            h,
        )?;
        // Later code needs to retrieve the CSS content
        // The hack is to use `entry_point_id`, which is otherwise unused, to store an index.
        chunk.entry_point.entry_point_id = asset_index.get();

        // Track css files that look like tailwind files.
        if let Some(map) = &mut dev.has_tailwind_plugin_hack {
            let first_1024 = &code.buffer[..code.buffer.len().min(1024)];
            if strings::index_of(first_1024, b"tailwind").is_some() {
                let entry = map.get_or_put(key)?;
                if !entry.found_existing {
                    *entry.key = Box::from(key);
                }
            } else {
                if let Some(_entry) = map.fetch_swap_remove(key) {
                    // key freed by Drop
                }
            }
        }

        dev.client_graph
            .receive_chunk(&mut ctx, index, incremental_graph::ChunkContent::Css(h), false)?;

        // If imported on server, there needs to be a server-side file entry
        // so that edges can be attached.
        if metadata.imported_on_server {
            dev.server_graph.insert_css_file_on_server(&mut ctx, index, key)?;
        }
    }

    for chunk in result.html_chunks().iter_mut() {
        let index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index);
        let compile_result = &chunk.compile_results_for_chunk[0].html();
        let generated_js = dev.generate_javascript_code_for_html_file(
            index,
            import_records,
            input_file_sources,
            bv2.graph.input_files.items_loader(),
        )?;
        dev.client_graph.receive_chunk(
            &mut ctx,
            index,
            incremental_graph::ChunkContent::Js(incremental_graph::JsChunk {
                code: &generated_js,
                source_map: None,
            }),
            false,
        )?;
        let client_index = ctx
            .get_cached_index::<{ bake::Side::Client }>(index)
            .unwrap_()
            .expect("unresolved index");
        let route_bundle_index = dev.client_graph.html_route_bundle_index(client_index);
        let route_bundle = dev.route_bundle_ptr(route_bundle_index);
        debug_assert!(route_bundle.data.html().bundled_file == client_index);
        let html = route_bundle.data.html_mut();

        if let Some(blob) = html.cached_response.take() {
            blob.deref_();
            route_bundle.invalidate_client_bundle(dev);
        }
        if let Some(_slice) = html.bundled_html_text.take() {
            // freed by Drop
        }
        #[cfg(feature = "allocation_scope")]
        dev.allocation_scope.assert_owned(&compile_result.code);
        html.bundled_html_text = Some(compile_result.code.clone()); // TODO(port): ownership transfer
        html.script_injection_offset =
            route_bundle::ScriptOffset::init(compile_result.script_injection_offset);

        chunk.entry_point.entry_point_id = u32::try_from(route_bundle_index.get()).unwrap();
    }

    // gts already initialized above; PORT NOTE: reshaped — Zig assigned ctx.gts here
    ctx.server_seen_bit_set = DynamicBitSet::init_empty(dev.server_graph.bundled_files.len())?;

    dev.incremental_result.had_adjusted_edges = false;

    dev.prepare_and_log_resolution_failures()?;

    // Pass 2, update the graph's edges by performing import diffing on each
    // changed file, removing dependencies. This pass also flags what routes
    // have been modified.
    for part_range in js_chunk.content.javascript().parts_in_chunk_in_order.iter() {
        match targets[part_range.source_index.get() as usize].bake_graph() {
            bake::Graph::Server | bake::Graph::Ssr => dev.server_graph.process_chunk_dependencies(
                &mut ctx,
                incremental_graph::DepKind::Normal,
                part_range.source_index,
            )?,
            bake::Graph::Client => dev.client_graph.process_chunk_dependencies(
                &mut ctx,
                incremental_graph::DepKind::Normal,
                part_range.source_index,
            )?,
        }
    }
    for chunk in result.html_chunks() {
        let index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index);
        dev.client_graph
            .process_chunk_dependencies(&mut ctx, incremental_graph::DepKind::Normal, index)?;
    }
    for chunk in result.css_chunks() {
        let entry_index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index);
        dev.client_graph
            .process_chunk_dependencies(&mut ctx, incremental_graph::DepKind::Css, entry_index)?;
    }

    // Index all failed files now that the incremental graph has been updated.
    if !dev.incremental_result.failures_removed.is_empty()
        || !dev.incremental_result.failures_added.is_empty()
    {
        had_sent_hmr_event = true;
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
            current_bundle.timer.elapsed().as_millis(),
        );
    }

    // Load all new chunks into the server runtime.
    if !dev.frontend_only && dev.server_graph.current_chunk_len > 0 {
        // Generate a script_id for server bundles
        let server_script_id = source_map_store::Key::init((1u64 << 63) | dev.generation as u64);

        // Get the source map if available and render to JSON
        let source_map_json = if !dev.server_graph.current_chunk_source_maps.is_empty() {
            'json: {
                // Create a temporary source map entry to render
                let mut source_map_entry = source_map_store::Entry {
                    ref_count: 1,
                    paths: Box::new([]),
                    files: Default::default(),
                    overlapping_memory_cost: 0,
                    dev_allocator: dev.dev_allocator(),
                };

                // Fill the source map entry
                // PERF(port): was ArenaAllocator
                dev.server_graph.take_source_map(&mut source_map_entry)?;
                let _cleanup = scopeguard::guard((), |_| {
                    source_map_entry.ref_count = 0;
                    source_map_entry.deinit();
                });

                let json_data = source_map_entry.render_json(
                    dev,
                    ChunkKind::HmrChunk,
                    bake::Side::Server,
                )?;
                break 'json Some(json_data);
            }
        } else {
            None
        };
        // _ = source_map_json freed by Drop

        let server_bundle = dev.server_graph.take_js_bundle(&incremental_graph::TakeOptions {
            kind: ChunkKind::HmrChunk,
            script_id: server_script_id,
            ..Default::default()
        })?;
        // freed by Drop

        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*dev.vm).global };
        let server_modules = if let Some(json) = source_map_json {
            // This memory will be owned by the `DevServerSourceProvider` in C++
            #[cfg(feature = "allocation_scope")]
            dev.allocation_scope.leak_slice(&json);
            let json = core::mem::ManuallyDrop::new(json);

            match c::bake_load_server_hmr_patch_with_source_map(
                global,
                BunString::clone_utf8(&server_bundle),
                json.as_ptr(),
                json.len(),
            ) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                    unsafe { &*dev.vm }
                        .print_error_like_object_to_console(global.take_exception(err));
                    panic!("Error thrown while evaluating server code. This is always a bug in the bundler.");
                }
            }
        } else {
            match c::bake_load_server_hmr_patch(global, BunString::clone_latin1(&server_bundle)) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                    unsafe { &*dev.vm }
                        .print_error_like_object_to_console(global.take_exception(err));
                    panic!("Error thrown while evaluating server code. This is always a bug in the bundler.");
                }
            }
        };
        let errors = match dev
            .server_register_update_callback
            .get()
            .unwrap()
            .call(
                global,
                global.to_js_value(),
                &[
                    server_modules,
                    dev.make_array_for_server_components_patch(
                        global,
                        &dev.incremental_result.client_components_added,
                    )?,
                    dev.make_array_for_server_components_patch(
                        global,
                        &dev.incremental_result.client_components_removed,
                    )?,
                ],
            ) {
            Ok(v) => v,
            Err(err) => {
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                unsafe { &*dev.vm }.print_error_like_object_to_console(global.take_exception(err));
                panic!(
                    "Error thrown in Hot-module-replacement code. This is always a bug in the HMR runtime."
                );
            }
        };
        let _ = errors; // TODO:
    }

    let mut route_bits = DynamicBitSet::init_empty(dev.route_bundles.len())?;
    let mut route_bits_client = DynamicBitSet::init_empty(dev.route_bundles.len())?;

    let mut has_route_bits_set = false;

    // PERF(port): was stack-fallback (65536)
    let mut hot_update_payload: Vec<u8> = Vec::with_capacity(65536);
    hot_update_payload.push(MessageId::HotUpdate.char());

    // The writer used for the hot_update payload
    macro_rules! w_int { ($t:ty, $v:expr) => { hot_update_payload.extend_from_slice(&<$t>::to_le_bytes($v)) }; }
    macro_rules! w_all { ($s:expr) => { hot_update_payload.extend_from_slice($s) }; }

    // It was discovered that if a tree falls with nobody around it, it does not
    // make any sound. Let's avoid writing into `w` if no sockets are open.
    let hot_update_subscribers = dev.num_subscribers(HmrTopic::HotUpdate);
    let will_hear_hot_update = hot_update_subscribers > 0;

    // This list of routes affected excludes client code.
    if will_hear_hot_update
        && current_bundle.had_reload_event
        && (dev.incremental_result.framework_routes_affected.len()
            + dev.incremental_result.html_routes_hard_affected.len())
            > 0
        && dev.bundling_failures.is_empty()
    {
        has_route_bits_set = true;

        for request in &dev.incremental_result.framework_routes_affected {
            let route = dev.router.route_ptr(request.route_index);
            if let Some(id) = route.bundle.unwrap_() {
                route_bits.set(id.get() as usize);
            }
            if request.should_recurse_when_visiting {
                mark_all_route_children(&dev.router, &mut [&mut route_bits], request.route_index);
            }
        }
        for route_bundle_index in &dev.incremental_result.html_routes_hard_affected {
            route_bits.set(route_bundle_index.get() as usize);
            route_bits_client.set(route_bundle_index.get() as usize);
        }

        // List 1
        let mut it = route_bits.iter_ones();
        while let Some(bundled_route_index) = it.next() {
            let bundle = &dev.route_bundles[bundled_route_index];
            if bundle.active_viewers == 0 {
                continue;
            }
            w_int!(i32, i32::try_from(bundled_route_index).unwrap());
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

        for index in &dev.incremental_result.client_components_affected {
            dev.server_graph
                .trace_dependencies(*index, ctx.gts, incremental_graph::TraceStop::NoStop, *index)?;
        }

        for request in &dev.incremental_result.framework_routes_affected {
            let route = dev.router.route_ptr(request.route_index);
            if let Some(id) = route.bundle.unwrap_() {
                route_bits.set(id.get() as usize);
                route_bits_client.set(id.get() as usize);
            }
            if request.should_recurse_when_visiting {
                mark_all_route_children(
                    &dev.router,
                    &mut [&mut route_bits, &mut route_bits_client],
                    request.route_index,
                );
            }
        }

        // Free old bundles
        let mut it = route_bits_client.iter_ones();
        while let Some(bundled_route_index) = it.next() {
            let bundle = &mut dev.route_bundles[bundled_route_index];
            bundle.invalidate_client_bundle(dev);
        }
    } else if !dev.incremental_result.html_routes_hard_affected.is_empty() {
        // Free old bundles
        let mut it = route_bits_client.iter_ones();
        while let Some(bundled_route_index) = it.next() {
            let bundle = &mut dev.route_bundles[bundled_route_index];
            bundle.invalidate_client_bundle(dev);
        }
    }

    // Softly affected HTML routes only need the bundle invalidated.
    if !dev.incremental_result.html_routes_soft_affected.is_empty() {
        for index in &dev.incremental_result.html_routes_soft_affected {
            dev.route_bundle_ptr(*index).invalidate_client_bundle(dev);
            route_bits.set(index.get() as usize);
        }
        has_route_bits_set = true;
    }

    // `route_bits` will have all of the routes that were modified.
    if has_route_bits_set && (will_hear_hot_update || dev.incremental_result.had_adjusted_edges) {
        let mut it = route_bits.iter_ones();
        // List 2
        while let Some(i) = it.next() {
            let route_bundle = dev.route_bundle_ptr(route_bundle::Index::init(u32::try_from(i).unwrap()));
            if dev.incremental_result.had_adjusted_edges {
                match &mut route_bundle.data {
                    route_bundle::Data::Framework(fw_bundle) => {
                        fw_bundle.cached_css_file_array.clear_without_deallocation()
                    }
                    route_bundle::Data::Html(html) => {
                        if let Some(blob) = html.cached_response.take() {
                            blob.deref_();
                        }
                    }
                }
            }
            if route_bundle.active_viewers == 0 || !will_hear_hot_update {
                continue;
            }
            w_int!(i32, i32::try_from(i).unwrap());

            // If no edges were changed, then it is impossible to
            // change the list of CSS files.
            if dev.incremental_result.had_adjusted_edges {
                ctx.gts.clear();
                dev.client_graph.current_css_files.clear();
                dev.trace_all_route_imports(route_bundle, ctx.gts, TraceImportGoal::FindCss)?;
                let css_ids = &dev.client_graph.current_css_files;

                w_int!(i32, i32::try_from(css_ids.len()).unwrap());
                for css_id in css_ids {
                    w_all!(&bun_core::fmt::bytes_to_hex_lower(&css_id.to_ne_bytes()));
                }
            } else {
                w_int!(i32, -1);
            }
        }
    }
    w_int!(i32, -1);

    let css_chunks = result.css_chunks();
    if will_hear_hot_update {
        if dev.client_graph.current_chunk_len > 0 || !css_chunks.is_empty() {
            // Send CSS mutations
            let asset_values = dev.assets.files.values();
            w_int!(u32, u32::try_from(css_chunks.len()).unwrap());
            let sources = bv2.graph.input_files.items_source();
            for chunk in css_chunks {
                let key = sources[chunk.entry_point.source_index as usize]
                    .path
                    .key_for_incremental_graph();
                w_all!(&bun_core::fmt::bytes_to_hex_lower(&hash(key).to_ne_bytes()));
                let css_data = &asset_values[chunk.entry_point.entry_point_id as usize]
                    .blob
                    .internal_blob()
                    .bytes;
                w_int!(u32, u32::try_from(css_data.len()).unwrap());
                w_all!(css_data);
            }

            // Send the JS chunk
            if dev.client_graph.current_chunk_len > 0 {
                let script_id = 'h: {
                    let mut source_map_hash = bundler::ContentHasher::Hash::init(0x4b12);
                    let keys = dev.client_graph.bundled_files.keys();
                    let values = dev.client_graph.bundled_files.values();
                    for part in &dev.client_graph.current_chunk_parts {
                        source_map_hash.update(&keys[part.get() as usize]);
                        let val = values[part.get() as usize].unpack();
                        if let Some(source_map) = val.source_map.get() {
                            source_map_hash.update(source_map.vlq());
                        }
                    }
                    // Set the bottom bit.
                    break 'h source_map_store::Key::init(source_map_hash.final_() | 1);
                };
                let mut sockets: u32 = 0;
                for socket_ptr in dev.active_websocket_connections.keys() {
                    // SAFETY: socket_ptr is a valid *mut HmrSocket owned by the connection map
                    let socket = unsafe { &mut **socket_ptr };
                    if socket.subscriptions.hot_update {
                        let entry = socket
                            .referenced_source_maps
                            .get_or_put(script_id)
                            .expect("oom");
                        if !entry.found_existing {
                            sockets += 1;
                        }
                        *entry.value = ();
                    }
                }
                map_log!("inc {:x}, for {} sockets", script_id.get(), sockets);
                let entry = match dev.source_maps.put_or_increment_ref_count(script_id, sockets)? {
                    source_map_store::PutResult::Uninitialized(entry) => 'brk: {
                        dev.client_graph.take_source_map(entry)?;
                        break 'brk entry;
                    }
                    source_map_store::PutResult::Shared(entry) => entry,
                };
                w_int!(u32, entry.overlapping_memory_cost);

                // Build and send the source chunk
                dev.client_graph.take_js_bundle_to_list(
                    &mut hot_update_payload,
                    &incremental_graph::TakeOptions {
                        kind: ChunkKind::HmrChunk,
                        script_id,
                        console_log: dev.should_receive_console_log_from_browser(),
                        ..Default::default()
                    },
                )?;
            }
        } else {
            w_int!(i32, 0);
        }

        dev.publish(HmrTopic::HotUpdate, &hot_update_payload, Opcode::Binary);
        had_sent_hmr_event = true;
    }

    if !dev.incremental_result.failures_added.is_empty() {
        dev.bundles_since_last_error = 0;

        let mut inspector_agent = dev.inspector();
        if current_bundle.promise.strong.has_value() {
            let _reset = scopeguard::guard((), |_| current_bundle.promise.reset());
            current_bundle
                .promise
                .set_route_bundle_state(dev, route_bundle::State::PossibleBundlingFailures);
            // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
            let global = unsafe { &*(*dev.vm).global };
            dev.send_serialized_failures(
                DevResponse::Promise(PromiseResponse {
                    promise: current_bundle.promise.strong.take(),
                    global,
                }),
                dev.bundling_failures.keys(),
                ErrorPageKind::Bundler,
                inspector_agent,
            )?;
        }

        while let Some(node) = current_bundle.requests.pop_first() {
            let req = &mut node.data;
            let _deref = scopeguard::guard((), |_| req.deref_());

            let rb = dev.route_bundle_ptr(req.route_bundle_index);
            rb.server_state = route_bundle::State::PossibleBundlingFailures;

            let resp: DevResponse = match &mut req.handler {
                Handler::Aborted => continue,
                Handler::ServerHandler(saved) => 'brk: {
                    let resp = saved.response;
                    saved.deinit();
                    break 'brk DevResponse::Http(resp);
                }
                Handler::BundledHtmlPage(ram) => DevResponse::Http(ram.response),
            };

            dev.send_serialized_failures(
                resp,
                dev.bundling_failures.keys(),
                ErrorPageKind::Bundler,
                inspector_agent,
            )?;
            inspector_agent = None;
        }
        if let Some(agent) = inspector_agent {
            let mut buf: Vec<u8> = Vec::new();
            dev.encode_serialized_failures(dev.bundling_failures.keys(), &mut buf, Some(agent))?;
        }

        return Ok(());
    }

    if dev.bundling_failures.is_empty() {
        if current_bundle.had_reload_event {
            let clear_terminal = !bun_output::scope_is_visible(DevServer)
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                && !unsafe { &*dev.vm }
                    .transpiler
                    .env
                    .has_set_no_clear_terminal_on_reload(false);
            if clear_terminal {
                Output::disable_buffering();
                Output::reset_terminal_all();
                Output::enable_buffering();
            }

            dev.print_memory_line();

            dev.bundles_since_last_error += 1;
            if dev.bundles_since_last_error > 1 {
                Output::pretty_error(format_args!("<cyan>[x{}]<r> ", dev.bundles_since_last_error));
            }
        } else {
            dev.bundles_since_last_error = 0;
            dev.print_memory_line();
        }

        let ms_elapsed = u64::try_from(current_bundle.timer.elapsed().as_millis()).unwrap();

        Output::pretty_error(format_args!(
            "<green>{} in {}ms<r>",
            if current_bundle.had_reload_event { "Reloaded" } else { "Bundled page" },
            ms_elapsed,
        ));

        // Intentionally creating a new scope here so we can limit the lifetime
        // of the `relative_path_buf`
        {
            let buf = paths::path_buffer_pool().get();

            // Compute a file name to display
            let file_name: Option<&[u8]> = if current_bundle.had_reload_event {
                if !bv2.graph.entry_points.is_empty() {
                    Some(dev.relative_path(
                        &mut *buf,
                        &bv2.graph.input_files.items_source()
                            [bv2.graph.entry_points[0].get() as usize]
                            .path
                            .text,
                    ))
                } else {
                    None // TODO: How does this happen
                }
            } else {
                'brk: {
                    let route_bundle_index = 'rbi: {
                        if let Some(first) = current_bundle.requests.first {
                            // SAFETY: first is an intrusive list node valid while current_bundle.requests holds it
                            break 'rbi unsafe { &*first }.data.route_bundle_index;
                        }
                        let route_bundle_indices = current_bundle.promise.route_bundle_indices.keys();
                        if route_bundle_indices.is_empty() {
                            break 'brk None;
                        }
                        break 'rbi route_bundle_indices[0];
                    };

                    break 'brk match &dev.route_bundle_ptr(route_bundle_index).data {
                        route_bundle::Data::Html(html) => {
                            Some(dev.relative_path(&mut *buf, &html.html_bundle.data.bundle.data.path))
                        }
                        route_bundle::Data::Framework(fw) => 'file_name: {
                            let route = dev.router.route_ptr(fw.route_index);
                            let opaque_id = match route.file_page.unwrap_().or(route.file_layout.unwrap_()) {
                                Some(id) => id,
                                None => break 'file_name None,
                            };
                            let server_index = from_opaque_file_id::<{ bake::Side::Server }>(opaque_id);
                            let abs_path =
                                &dev.server_graph.bundled_files.keys()[server_index.get() as usize];
                            break 'file_name Some(dev.relative_path(&mut *buf, abs_path));
                        }
                    };
                }
            };

            let total_count = bv2.graph.entry_points.len();
            if let Some(name) = file_name {
                Output::pretty_error(format_args!("<d>:<r> {}", bstr::BStr::new(name)));
                if total_count > 1 {
                    Output::pretty_error(format_args!(" <d>+ {} more<r>", total_count - 1));
                }
            }
        }
        Output::pretty_error("\n");
        Output::flush();

        if let Some(agent) = dev.inspector() {
            agent.notify_bundle_complete(dev.inspector_server_id, ms_elapsed as f64);
        }
    }

    // Release the lock because the underlying handler may acquire one.
    dev.graph_safety_lock.unlock();
    let _relock = scopeguard::guard((), |_| dev.graph_safety_lock.lock());

    // Set all the deferred routes to the .loaded state up front
    {
        let mut node = current_bundle.requests.first;
        while let Some(n) = node {
            // SAFETY: n is an intrusive list node valid while current_bundle.requests holds it
            let n = unsafe { &*n };
            let rb = dev.route_bundle_ptr(n.data.route_bundle_index);
            rb.server_state = route_bundle::State::Loaded;
            node = n.next;
        }
    }

    if current_bundle.promise.strong.has_value() {
        let _deinit = scopeguard::guard((), |_| current_bundle.promise.deinit_idempotently());
        current_bundle.promise.set_route_bundle_state(dev, route_bundle::State::Loaded);
        // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
        let vm = unsafe { &*dev.vm };
        vm.event_loop().enter();
        let _exit = scopeguard::guard((), |_| vm.event_loop().exit());
        current_bundle.promise.strong.resolve(vm.global, JSValue::TRUE)?;
    }

    while let Some(node) = current_bundle.requests.pop_first() {
        let req = &mut node.data;
        let _deref = scopeguard::guard((), |_| req.deref_());

        let rb = dev.route_bundle_ptr(req.route_bundle_index);
        rb.server_state = route_bundle::State::Loaded;

        match &req.handler {
            Handler::Aborted => continue,
            Handler::ServerHandler(saved) => dev.on_framework_request_with_bundle(
                req.route_bundle_index,
                SavedRequest::Union::Saved(saved.clone()),
                saved.response,
            )?,
            Handler::BundledHtmlPage(ram) => {
                dev.on_html_request_with_bundle(req.route_bundle_index, ram.response, ram.method)
            }
        }
    }
    Ok(())
}

impl DevServer {
    fn start_next_bundle_if_present(&mut self) {
        debug_assert!(self.magic == Magic::Valid);
        // Clear the current bundle
        debug_assert!(self.current_bundle.is_none());
        self.emit_visualizer_message_if_needed();

        // If there were pending requests, begin another bundle.
        if self.next_bundle.reload_event.is_some()
            || self.next_bundle.requests.first.is_some()
            || self.next_bundle.promise.strong.has_value()
        {
            // PERF(port): was stack-fallback (4096)
            let mut entry_points = EntryPointList::EMPTY;

            let (is_reload, timer) = if let Some(event) = self.next_bundle.reload_event.take() {
                'brk: {
                    // SAFETY: event points into self.watcher_atomics.events[]
                    let event = unsafe { &mut *event };
                    let reload_event_timer = event.timer;

                    let mut current = event;
                    loop {
                        current.process_file_list(self, &mut entry_points);
                        let Some(next) = self.watcher_atomics.recycle_event_from_dev_server(current)
                        else {
                            break;
                        };
                        current = next;
                        #[cfg(debug_assertions)]
                        debug_assert!(current.debug_mutex.try_lock());
                    }

                    break 'brk (true, reload_event_timer);
                }
            } else {
                (false, Instant::now())
            };

            for route_bundle_index in self.next_bundle.route_queue.keys() {
                let rb = self.route_bundle_ptr(*route_bundle_index);
                rb.server_state = route_bundle::State::Bundling;
                self.append_route_entry_points_if_not_stale(&mut entry_points, *route_bundle_index)
                    .expect("oom");
            }

            if !entry_points.set.is_empty() {
                self.start_async_bundle(entry_points, is_reload, timer).expect("oom");
            }

            self.next_bundle.route_queue.clear();
        }
    }

    /// Note: The log is not consumed here
    pub fn handle_parse_task_failure(
        &mut self,
        err: bun_core::Error,
        graph: bake::Graph,
        abs_path: &[u8],
        log: &Log,
        bv2: &mut BundleV2,
    ) -> Result<(), AllocError> {
        self.graph_safety_lock.lock();
        let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());

        debug_log!(
            "handleParseTaskFailure({}, .{}, {:?}, {} messages)",
            err.name(),
            <&'static str>::from(graph),
            bun_core::fmt::quote(abs_path),
            log.msgs.len(),
        );

        if err == bun_core::err!(FileNotFound) || err == bun_core::err!(ModuleNotFound) {
            // Special-case files being deleted.
            match graph {
                bake::Graph::Server | bake::Graph::Ssr => {
                    self.server_graph.on_file_deleted(abs_path, bv2)
                }
                bake::Graph::Client => self.client_graph.on_file_deleted(abs_path, bv2),
            }
        } else {
            match graph {
                bake::Graph::Server => self
                    .server_graph
                    .insert_failure(incremental_graph::FailureKey::AbsPath, abs_path, log, false)?,
                bake::Graph::Ssr => self
                    .server_graph
                    .insert_failure(incremental_graph::FailureKey::AbsPath, abs_path, log, true)?,
                bake::Graph::Client => self
                    .client_graph
                    .insert_failure(incremental_graph::FailureKey::AbsPath, abs_path, log, false)?,
            }
        }
        Ok(())
    }

    /// Return a log to write resolution failures into.
    pub fn get_log_for_resolution_failures(
        &mut self,
        abs_path: &[u8],
        graph: bake::Graph,
    ) -> Result<&mut Log, bun_core::Error> {
        debug_assert!(self.current_bundle.is_some());

        self.graph_safety_lock.lock();
        let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());

        // TODO(port): `switch (graph == .client) { inline else => |is_client| ... }` — unrolled
        let owner = if graph == bake::Graph::Client {
            serialized_failure::Owner::Client(self.client_graph.insert_stale(abs_path, false)?).encode()
        } else {
            serialized_failure::Owner::Server(
                self.server_graph.insert_stale(abs_path, graph == bake::Graph::Ssr)?,
            )
            .encode()
        };
        let current_bundle = self.current_bundle.as_mut().unwrap();
        let gop = current_bundle.resolution_failure_entries.get_or_put(owner)?;
        if !gop.found_existing {
            *gop.value = Log::init();
        }
        Ok(gop.value)
    }
}

pub struct CacheEntry {
    pub kind: FileKind,
}

impl DevServer {
    pub fn is_file_cached(&mut self, path: &[u8], side: bake::Graph) -> Option<CacheEntry> {
        // Barrel files with deferred records must always be re-parsed.
        if self.barrel_files_with_deferrals.contains_key(path) {
            return None;
        }

        self.graph_safety_lock.lock();
        let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());

        // TODO(port): switch (side) { inline else => |side_comptime| ... } — unrolled
        macro_rules! check {
            ($g:expr) => {{
                let g = $g;
                let index = g.bundled_files.get_index(path)?;
                if !g.stale_files.is_set(index) {
                    return Some(CacheEntry {
                        kind: g
                            .get_file_by_index(incremental_graph::FileIndex::init(
                                u32::try_from(index).unwrap(),
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
    ) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used `anytype` and matched on @TypeOf; using From/Into.
        let file = match optional_id.into() {
            OpaqueFileIdOrOptional::Optional(o) => match o.unwrap_() {
                Some(f) => f,
                None => return Ok(()),
            },
            OpaqueFileIdOrOptional::Id(f) => f,
        };

        let file_index = from_opaque_file_id::<SIDE>(file);
        let stale = match SIDE {
            bake::Side::Server => self.server_graph.stale_files.is_set(file_index.get() as usize),
            bake::Side::Client => self.client_graph.stale_files.is_set(file_index.get() as usize),
        };
        if stale {
            entry_points.append_js(&file_names[file_index.get() as usize], SIDE.graph())?;
        }
        Ok(())
    }

    pub fn route_bundle_ptr(&mut self, idx: route_bundle::Index) -> &mut RouteBundle {
        &mut self.route_bundles[idx.get() as usize]
    }
}

// TODO(port): helper enum for `optional_id: anytype` in append_opaque_entry_point
pub enum OpaqueFileIdOrOptional {
    Id(OpaqueFileId),
    Optional(framework_router::OpaqueFileIdOptional),
}

fn on_request<R>(dev: &mut DevServer, req: &mut Request, resp: &mut R)
where
    R: uws::ResponseLike, // TODO(port): resp: anytype
{
    let mut params: framework_router::MatchedParams = Default::default();
    if let Some(route_index) = dev.router.match_slow(req.url(), &mut params) {
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev,
            req: ReqOrSaved::Req(req),
            resp: AnyResponse::init(resp),
            kind: deferred_request::HandlerKind::ServerHandler,
            route_bundle_index: dev
                .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                .expect("oom"),
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(dev, rbi, &mut ctx) {
            Ok(()) => {}
            Err(jsc::JsError::Thrown) | Err(jsc::JsError::Terminated) =>
                // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
                unsafe { &*(*dev.vm).global }.report_active_exception_as_unhandled(),
            Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
        }
        return;
    }

    if !dev.server.as_ref().unwrap().config().on_request.is_empty() {
        dev.server.as_ref().unwrap().on_request(req, AnyResponse::init(resp));
        return;
    }

    send_built_in_not_found(resp);
}

impl DevServer {
    // TODO: path params
    pub fn handle_render_redirect(
        &mut self,
        saved_request: SavedRequest,
        render_path: &[u8],
        resp: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        // Match the render path against the router
        let mut params: framework_router::MatchedParams = Default::default();
        if let Some(route_index) = self.router.match_slow(render_path, &mut params) {
            let mut ctx = RequestEnsureRouteBundledCtx {
                dev: self,
                req: ReqOrSaved::Saved(saved_request),
                resp,
                kind: deferred_request::HandlerKind::ServerHandler,
                route_bundle_index: self
                    .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                    .expect("oom"),
            };
            let rbi = ctx.route_bundle_index;
            // Found a matching route, bundle it and handle the request
            ensure_route_is_bundled(self, rbi, &mut ctx)?;
            return Ok(());
        }

        // No matching route found - render 404
        send_built_in_not_found(resp);
        Ok(())
    }

    pub fn respond_for_html_bundle(
        &mut self,
        html: &mut HTMLBundle::HTMLBundleRoute,
        req: &mut Request,
        resp: AnyResponse,
    ) -> Result<(), AllocError> {
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev: self,
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::BundledHtmlPage,
            route_bundle_index: self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))?,
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(self, rbi, &mut ctx) {
            Ok(()) => {}
            Err(jsc::JsError::Thrown) | Err(jsc::JsError::Terminated) =>
                // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
                unsafe { &*(*self.vm).global }.report_active_exception_as_unhandled(),
            Err(jsc::JsError::OutOfMemory) => return Err(AllocError),
        }
        Ok(())
    }

    fn get_or_put_route_bundle(
        &mut self,
        route: route_bundle::UnresolvedIndex,
    ) -> Result<route_bundle::Index, bun_core::Error> {
        let index_location: *mut route_bundle::IndexOptional = match &route {
            route_bundle::UnresolvedIndex::Framework(route_index) => {
                &mut self.router.route_ptr(*route_index).bundle
            }
            route_bundle::UnresolvedIndex::Html(html) => &mut html.dev_server_id,
        };
        // SAFETY: index_location points into self which outlives this fn
        if let Some(bundle_index) = unsafe { (*index_location).unwrap_() } {
            return Ok(bundle_index);
        }

        self.graph_safety_lock.lock();
        let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());

        let bundle_index = route_bundle::Index::init(u32::try_from(self.route_bundles.len()).unwrap());

        self.route_bundles.reserve(1);
        // PERF(port): was assume_capacity
        self.route_bundles.push(RouteBundle {
            data: match route {
                route_bundle::UnresolvedIndex::Framework(route_index) => {
                    route_bundle::Data::Framework(route_bundle::Framework {
                        route_index,
                        evaluate_failure: None,
                        cached_module_list: jsc::StrongOptional::EMPTY,
                        cached_client_bundle_url: jsc::StrongOptional::EMPTY,
                        cached_css_file_array: jsc::StrongOptional::EMPTY,
                    })
                }
                route_bundle::UnresolvedIndex::Html(html) => 'brk: {
                    let incremental_graph_index = self
                        .client_graph
                        .insert_stale_extra(&html.bundle.data.path, false, true)?;
                    let packed_file =
                        &mut self.client_graph.bundled_files.values_mut()[incremental_graph_index.get() as usize];
                    let mut file = packed_file.unpack();
                    file.html_route_bundle_index = Some(bundle_index);
                    *packed_file = file.pack();
                    break 'brk route_bundle::Data::Html(route_bundle::HTML {
                        html_bundle: HTMLBundle::HTMLBundleRoute::Ref::init_ref(html),
                        bundled_file: incremental_graph_index,
                        script_injection_offset: route_bundle::ScriptOffset::NONE,
                        cached_response: None,
                        bundled_html_text: None,
                    });
                }
            },
            client_script_generation: bun_core::random::int::<u32>(),
            server_state: route_bundle::State::Unqueued,
            client_bundle: None,
            active_viewers: 0,
        });
        // SAFETY: index_location still valid (route_bundles is a separate field)
        unsafe { *index_location = bundle_index.to_optional() };
        Ok(bundle_index)
    }

    fn register_catch_all_html_route(
        &mut self,
        html: &mut HTMLBundle::HTMLBundleRoute,
    ) -> Result<(), bun_core::Error> {
        let bundle_index = self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))?;
        self.html_router.fallback = bundle_index.to_optional();
        // TODO(port): Zig set `.fallback = bundle_index.toOptional()` but field type is
        // `?*HTMLBundle.HTMLBundleRoute` per LIFETIMES.tsv — likely the LIFETIMES row is
        // for an older version. Following Zig source: fallback stores RouteBundle.Index.Optional
        Ok(())
    }
}

#[derive(Copy, Clone)]
enum ErrorPageKind {
    /// Modules failed to bundle
    Bundler,
    /// Modules failed to evaluate
    Evaluation,
    /// Request handler threw
    Runtime,
}

impl DevServer {
    fn encode_serialized_failures(
        &self,
        failures: &[SerializedFailure],
        buf: &mut Vec<u8>,
        inspector_agent: Option<&mut BunFrontendDevServerAgent>,
    ) -> Result<(), AllocError> {
        let mut all_failures_len: usize = 0;
        for fail in failures {
            all_failures_len += fail.data.len();
        }
        let mut all_failures: Vec<u8> = Vec::with_capacity(all_failures_len);
        for fail in failures {
            all_failures.extend_from_slice(&fail.data);
            // PERF(port): was assume_capacity
        }

        let failures_start_buf_pos = buf.len();

        let len = bun_base64::encode_len(&all_failures);
        buf.reserve(len);
        // TODO(port): Zig wrote into unusedCapacitySlice() then bumped len
        let to_write_into = &mut buf.spare_capacity_mut()[..len];
        // SAFETY: to_write_into is valid uninit memory of length `len`
        let written = bun_base64::encode(
            unsafe { core::slice::from_raw_parts_mut(to_write_into.as_mut_ptr() as *mut u8, len) },
            &all_failures,
        );
        // SAFETY: `written` bytes of spare_capacity were initialized by encode() above
        unsafe { buf.set_len(buf.len() + written) };

        // Re-use the encoded buffer to avoid encoding failures more times than neccecary.
        if let Some(agent) = inspector_agent {
            debug_assert!(agent.is_enabled());
            let failures_encoded = &buf[failures_start_buf_pos..];
            let mut s = BunString::init_latin1_or_ascii_view(failures_encoded);
            let _deref = scopeguard::guard((), |_| s.deref_());
            agent.notify_bundle_failed(self.inspector_server_id, &mut s);
        }
        Ok(())
    }

    fn send_serialized_failures(
        &mut self,
        resp: DevResponse,
        failures: &[SerializedFailure],
        kind: ErrorPageKind,
        inspector_agent: Option<&mut BunFrontendDevServerAgent>,
    ) -> Result<(), bun_core::Error> {
        let mut buf: Vec<u8> = Vec::with_capacity(2048);

        // TODO(port): switch (kind) { inline else => |k| std.fmt.comptimePrint(...) }
        // → const_format would need const enum-dependent string; using match on runtime kind.
        let page_title = match kind {
            ErrorPageKind::Bundler => "Build Failed",
            ErrorPageKind::Evaluation | ErrorPageKind::Runtime => "Runtime Error",
        };
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
            bun_core::Global::PACKAGE_JSON_VERSION_WITH_CANARY,
            "\"};"
        );
        let post = "</script></body></html>";

        if Environment::CODEGEN_EMBED {
            buf.extend_from_slice(pre.as_bytes());
            buf.extend_from_slice(include_bytes!("bake-codegen/bake.error.js"));
            buf.extend_from_slice(post.as_bytes());
        } else {
            buf.extend_from_slice(pre.as_bytes());
            buf.extend_from_slice(bun_core::runtime_embed_file(
                bun_core::EmbedKind::CodegenEager,
                "bake.error.js",
            ));
            buf.extend_from_slice(post.as_bytes());
        }

        match resp {
            DevResponse::Http(r) => StaticRoute::send_blob_then_deinit(
                r,
                &Blob::Any::from_array_list(buf),
                StaticRoute::Options {
                    mime_type: &MimeType::HTML,
                    server: self.server.unwrap(),
                    status_code: 500,
                    ..Default::default()
                },
            ),
            DevResponse::Promise(mut r) => {
                let global = r.global;
                let mut any_blob = Blob::Any::from_array_list(buf);
                let mut headers = bun_http::Headers::from(None, bun_http::HeadersOptions { body: Some(&any_blob) })?;
                headers.append("Content-Type", MimeType::HTML.value).expect("oom");
                if headers.get("etag").is_none() {
                    if !any_blob.slice().is_empty() {
                        bun_http::ETag::append_to_headers(any_blob.slice(), &mut headers).expect("oom");
                    }
                }
                let fetch_headers = headers.to_fetch_headers(global)?;
                let mut response = Response::init(
                    Response::Init {
                        status_code: 500,
                        headers: fetch_headers,
                    },
                    Response::Body {
                        value: Response::BodyValue::Blob(any_blob.to_blob(global)),
                    },
                    BunString::EMPTY,
                    false,
                );
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                let vm = unsafe { &*self.vm };
                vm.event_loop().enter();
                let _exit = scopeguard::guard((), |_| vm.event_loop().exit());
                r.promise.reject(global, response.to_js(global))?;
            }
        }
        Ok(())
    }
}

fn send_built_in_not_found<R: uws::ResponseLike>(resp: R) {
    let message = "404 Not Found";
    resp.write_status("404 Not Found");
    resp.end(message, true);
}

impl DevServer {
    fn print_memory_line(&self) {
        if !AllocationScope::ENABLED {
            return;
        }
        if !bun_output::scope_is_visible(DevServer) {
            return;
        }
        let stats = self.allocation_scope.stats();
        Output::pretty_errorln(format_args!(
            "<d>DevServer tracked {}, measured: {} ({}), process: {}<r>",
            bun_core::fmt::size(self.memory_cost(), Default::default()),
            stats.num_allocations,
            bun_core::fmt::size(stats.total_memory_allocated, Default::default()),
            bun_core::fmt::size(sys::self_process_memory_usage().unwrap_or(0), Default::default()),
        ));
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FileKind {
    /// Files that failed to bundle or do not exist on disk will appear in the
    /// graph as "unknown".
    Unknown = 0,
    /// `code` is JavaScript code. This field is also used for HTML files.
    Js = 1,
    /// `code` is JavaScript code of a module exporting a single file path.
    Asset = 2,
    /// `code` is the URL where the CSS file is to be fetched from.
    Css = 3,
}

impl FileKind {
    pub fn has_inline_js_code_chunk(self) -> bool {
        matches!(self, FileKind::Js | FileKind::Asset)
    }
}

pub struct IncrementalResult {
    pub framework_routes_affected: Vec<RouteIndexAndRecurseFlag>,
    pub html_routes_soft_affected: Vec<route_bundle::Index>,
    pub html_routes_hard_affected: Vec<route_bundle::Index>,
    pub had_adjusted_edges: bool,
    pub client_components_added: Vec<incremental_graph::ServerFileIndex>,
    pub client_components_removed: Vec<incremental_graph::ServerFileIndex>,
    pub failures_removed: Vec<SerializedFailure>,
    pub client_components_affected: Vec<incremental_graph::ServerFileIndex>,
    pub failures_added: Vec<SerializedFailure>,
}

impl IncrementalResult {
    pub const EMPTY: IncrementalResult = IncrementalResult {
        framework_routes_affected: Vec::new(),
        html_routes_soft_affected: Vec::new(),
        html_routes_hard_affected: Vec::new(),
        had_adjusted_edges: false,
        failures_removed: Vec::new(),
        failures_added: Vec::new(),
        client_components_added: Vec::new(),
        client_components_removed: Vec::new(),
        client_components_affected: Vec::new(),
    };

    fn reset(&mut self) {
        self.framework_routes_affected.clear();
        self.html_routes_soft_affected.clear();
        self.html_routes_hard_affected.clear();
        debug_assert!(self.failures_removed.is_empty());
        self.failures_added.clear();
        self.client_components_added.clear();
        self.client_components_removed.clear();
        self.client_components_affected.clear();
    }
}

/// Used during an incremental update to determine what "HMR roots"
/// are affected.
pub struct GraphTraceState {
    pub client_bits: DynamicBitSet,
    pub server_bits: DynamicBitSet,
}

impl GraphTraceState {
    pub fn bits(&mut self, side: bake::Side) -> &mut DynamicBitSet {
        match side {
            bake::Side::Client => &mut self.client_bits,
            bake::Side::Server => &mut self.server_bits,
        }
    }

    pub fn clear(&mut self) {
        self.server_bits.set_all(false);
        self.client_bits.set_all(false);
    }

    pub fn resize(&mut self, side: bake::Side, new_size: usize) -> Result<(), bun_core::Error> {
        let b = match side {
            bake::Side::Client => &mut self.client_bits,
            bake::Side::Server => &mut self.server_bits,
        };
        if b.bit_length() < new_size {
            b.resize(new_size, false)?;
        }
        Ok(())
    }

    pub fn clear_and_free(&mut self) {
        self.client_bits.resize(0, false).expect("freeing memory can not fail");
        self.server_bits.resize(0, false).expect("freeing memory can not fail");
    }
}

// GraphTraceState::deinit → Drop on DynamicBitSet (allocator param dropped)

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TraceImportGoal {
    FindCss,
    FindClientModules,
    FindErrors,
}

impl DevServer {
    /// `extra_client_bits` is specified if it is possible that the client graph may
    /// increase in size while the bits are being used.
    fn init_graph_trace_state(
        &self,
        extra_client_bits: usize,
    ) -> Result<GraphTraceState, bun_core::Error> {
        let server_bits = DynamicBitSet::init_empty(self.server_graph.bundled_files.len())?;
        let client_bits =
            DynamicBitSet::init_empty(self.client_graph.bundled_files.len() + extra_client_bits)?;
        Ok(GraphTraceState { server_bits, client_bits })
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ChunkKind {
    InitialResponse = 0,
    HmrChunk = 1,
}

// For debugging, it is helpful to be able to see bundles.
pub fn dump_bundle(
    dump_dir: &mut sys::Dir,
    graph: bake::Graph,
    rel_path: &[u8],
    chunk: &[u8],
    wrap: bool,
) -> Result<(), bun_core::Error> {
    let buf = paths::path_buffer_pool().get();
    let name = &paths::join_abs_string_buf(
        b"/",
        &mut *buf,
        &[<&'static str>::from(graph).as_bytes(), rel_path],
        paths::Style::Auto,
    )[1..];
    // TODO(port): std.fs.Dir.makeOpenPath / createFile — use bun_sys
    let mut inner_dir = dump_dir.make_open_path(paths::dirname(name).unwrap())?;

    let file = inner_dir.create_file(paths::basename(name))?;
    let mut file_buffer = [0u8; 1024];
    let mut bufw = file.buffered_writer(&mut file_buffer);

    if !strings::has_suffix(rel_path, b".map") {
        write!(
            bufw,
            "// {:?} bundled for {}\n",
            bun_core::fmt::quote(rel_path),
            <&'static str>::from(graph),
        )?;
        write!(
            bufw,
            "// Bundled at {}, Bun {}\n",
            bun_core::time::nano_timestamp(),
            bun_core::Global::PACKAGE_JSON_VERSION_WITH_CANARY,
        )?;
    }

    if wrap {
        bufw.write_all(b"({\n")?;
    }

    bufw.write_all(chunk)?;

    if wrap {
        bufw.write_all(b"});\n")?;
    }

    bufw.flush()?;
    Ok(())
}

#[inline(never)]
pub fn dump_bundle_for_chunk(
    dev: &DevServer,
    dump_dir: &mut sys::Dir,
    side: bake::Side,
    key: &[u8],
    code: &[u8],
    wrap: bool,
    is_ssr_graph: bool,
) {
    let cwd = &dev.root;
    let mut a = PathBuffer::uninit();
    let mut b = [0u8; MAX_PATH_BYTES * 2];
    let rel_path = paths::relative_buf_z(&mut a, cwd, key);
    let from = const_format::concatcp!("..", paths::SEP_STR);
    let to = const_format::concatcp!("_.._", paths::SEP_STR);
    let size = bun_str::strings::replacement_size(rel_path, from.as_bytes(), to.as_bytes());
    let _ = bun_str::strings::replace(rel_path, from.as_bytes(), to.as_bytes(), &mut b);
    let rel_path_escaped = &b[..size];
    if let Err(err) = dump_bundle(
        dump_dir,
        match side {
            bake::Side::Client => bake::Graph::Client,
            bake::Side::Server => {
                if is_ssr_graph {
                    bake::Graph::Ssr
                } else {
                    bake::Graph::Server
                }
            }
        },
        rel_path_escaped,
        code,
        wrap,
    ) {
        Output::warn(format_args!("Could not dump bundle: {}", err));
    }
}

impl DevServer {
    pub fn emit_visualizer_message_if_needed(&mut self) {
        #[cfg(not(feature = "bake_debugging_features"))]
        return;
        let _emit_mem = scopeguard::guard((), |_| self.emit_memory_visualizer_message_if_needed());
        if self.emit_incremental_visualizer_events == 0 {
            return;
        }

        // PERF(port): was stack-fallback (65536)
        let mut payload: Vec<u8> = Vec::with_capacity(65536);

        if self.write_visualizer_message(&mut payload).is_err() {
            return; // visualizer does not get an update if it OOMs
        }

        self.publish(HmrTopic::IncrementalVisualizer, &payload, Opcode::Binary);
    }

    pub fn emit_memory_visualizer_message_timer(timer: &mut EventLoopTimer, _: &bun_core::Timespec) {
        #[cfg(not(feature = "bake_debugging_features"))]
        return;
        // SAFETY: timer is the .memory_visualizer_timer field of DevServer
        let dev: &mut DevServer = unsafe {
            &mut *((timer as *mut _ as *mut u8)
                .sub(offset_of!(DevServer, memory_visualizer_timer))
                as *mut DevServer)
        };
        debug_assert!(dev.magic == Magic::Valid);
        dev.emit_memory_visualizer_message();
        timer.state = EventLoopTimer::State::FIRED;
        // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
        unsafe { &*dev.vm }
            .timer
            .update(timer, &bun_core::Timespec::ms_from_now(bun_core::TimespecMode::AllowMockedTime, 1000));
    }

    pub fn emit_memory_visualizer_message_if_needed(&mut self) {
        #[cfg(not(feature = "bake_debugging_features"))]
        return;
        if self.emit_memory_visualizer_events == 0 {
            return;
        }
        self.emit_memory_visualizer_message();
    }

    pub fn emit_memory_visualizer_message(&mut self) {
        const _: () = assert!(cfg!(feature = "bake_debugging_features"));
        debug_assert!(self.emit_memory_visualizer_events > 0);

        // PERF(port): was stack-fallback (65536)
        let mut payload: Vec<u8> = Vec::with_capacity(65536);
        payload.push(MessageId::MemoryVisualizer.char());
        if self.write_memory_visualizer_message(&mut payload).is_err() {
            return; // drop packet
        }
        self.publish(HmrTopic::MemoryVisualizer, &payload, Opcode::Binary);
    }

    pub fn write_memory_visualizer_message(&self, payload: &mut Vec<u8>) -> Result<(), bun_core::Error> {
        #[repr(C)]
        struct Fields {
            incremental_graph_client: u32,
            incremental_graph_server: u32,
            js_code: u32,
            source_maps: u32,
            assets: u32,
            other: u32,
            devserver_tracked: u32,
            process_used: u32,
            system_used: u32,
            system_total: u32,
        }
        let cost = self.memory_cost_detailed();
        let system_total = bun_runtime::node::os::totalmem();
        let fields = Fields {
            incremental_graph_client: cost.incremental_graph_client as u32,
            incremental_graph_server: cost.incremental_graph_server as u32,
            js_code: cost.js_code as u32,
            source_maps: cost.source_maps as u32,
            assets: cost.assets as u32,
            other: cost.other as u32,
            devserver_tracked: if AllocationScope::ENABLED {
                self.allocation_scope.stats().total_memory_allocated as u32
            } else {
                0
            },
            process_used: sys::self_process_memory_usage().unwrap_or(0) as u32,
            system_used: system_total.saturating_sub(bun_runtime::node::os::freemem()) as u32,
            system_total: system_total as u32,
        };
        // SAFETY: Fields is repr(C) POD
        payload.extend_from_slice(unsafe {
            core::slice::from_raw_parts(
                &fields as *const _ as *const u8,
                core::mem::size_of::<Fields>(),
            )
        });

        // SourceMapStore is easy to leak refs in.
        {
            let keys = self.source_maps.entries.keys();
            let values = self.source_maps.entries.values();
            payload.extend_from_slice(&u32::try_from(keys.len()).unwrap().to_le_bytes());
            for (key, value) in keys.iter().zip(values) {
                debug_assert!(value.ref_count > 0);
                payload.extend_from_slice(&key.get().to_ne_bytes());
                payload.extend_from_slice(&value.ref_count.to_le_bytes());
                if let Some(entry) = self.source_maps.locate_weak_ref(*key) {
                    payload.extend_from_slice(&entry.ref_.count.to_le_bytes());
                    // floats are easier to decode in JS
                    payload.extend_from_slice(&(entry.ref_.expire as f64).to_ne_bytes());
                } else {
                    payload.extend_from_slice(&0u32.to_le_bytes());
                }
                payload.extend_from_slice(&(value.files.len() as u32).to_le_bytes());
                payload.extend_from_slice(&value.overlapping_memory_cost.to_le_bytes());
            }
        }
        Ok(())
    }

    pub fn write_visualizer_message(&self, payload: &mut Vec<u8>) -> Result<(), bun_core::Error> {
        payload.push(MessageId::Visualizer.char());
        // PERF(port): was assume_capacity

        // TODO(port): inline for over [2]bake.Side + .{client_graph, server_graph} — unrolled
        macro_rules! emit_files {
            ($side:expr, $g:expr) => {{
                let g = $g;
                payload.extend_from_slice(&u32::try_from(g.bundled_files.len()).unwrap().to_le_bytes());
                for (i, (k, v)) in g.bundled_files.keys().iter().zip(g.bundled_files.values()).enumerate() {
                    let file = v.unpack();
                    let buf = paths::path_buffer_pool().get();
                    let normalized_key = self.relative_path(&mut *buf, k);
                    payload.extend_from_slice(&u32::try_from(normalized_key.len()).unwrap().to_le_bytes());
                    if k.is_empty() { continue; }
                    payload.extend_from_slice(normalized_key);
                    payload.push((g.stale_files.is_set_allow_out_of_bound(i, true) || file.failed) as u8);
                    payload.push(($side == bake::Side::Server && file.is_rsc) as u8);
                    payload.push(($side == bake::Side::Server && file.is_ssr) as u8);
                    payload.push(match $side {
                        bake::Side::Server => file.is_route,
                        bake::Side::Client => file.html_route_bundle_index.is_some(),
                    } as u8);
                    payload.push(($side == bake::Side::Client && file.is_special_framework_file) as u8);
                    payload.push(match $side {
                        bake::Side::Server => file.is_client_component_boundary,
                        bake::Side::Client => file.is_hmr_root,
                    } as u8);
                }
            }};
        }
        emit_files!(bake::Side::Client, &self.client_graph);
        emit_files!(bake::Side::Server, &self.server_graph);

        macro_rules! emit_edges {
            ($g:expr) => {{
                let g = $g;
                payload.extend_from_slice(
                    &u32::try_from(g.edges.len() - g.edges_free_list.len()).unwrap().to_le_bytes(),
                );
                for (i, edge) in g.edges.iter().enumerate() {
                    if g.edges_free_list
                        .iter()
                        .any(|e| *e == incremental_graph::EdgeIndex::init(u32::try_from(i).unwrap()))
                    {
                        continue;
                    }
                    payload.extend_from_slice(&u32::try_from(edge.dependency.get()).unwrap().to_le_bytes());
                    payload.extend_from_slice(&u32::try_from(edge.imported.get()).unwrap().to_le_bytes());
                }
            }};
        }
        emit_edges!(&self.client_graph);
        emit_edges!(&self.server_graph);
        Ok(())
    }

    pub fn on_web_socket_upgrade<R>(
        &mut self,
        res: &mut R,
        req: &mut Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) where
        R: uws::ResponseLike,
    {
        debug_assert!(id == 0);

        let dw = HmrSocket::new(self, res);
        self.active_websocket_connections.put(dw, ()).expect("oom");
        let _ = res.upgrade::<*mut HmrSocket>(
            dw,
            req.header("sec-websocket-key").unwrap_or(b""),
            req.header("sec-websocket-protocol").unwrap_or(b""),
            req.header("sec-websocket-extension").unwrap_or(b""),
            upgrade_ctx,
        );
    }
}

/// Every message is to use `.binary`/`ArrayBuffer` transport mode. The first byte
/// indicates a Message ID; see comments on each type for how to interpret the rest.
/// All integers are sent in little-endian.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum MessageId {
    /// Version payload. Sent on connection startup.
    Version = b'V',
    /// Sent on a successful bundle, containing client code, updates routes, and
    /// changed CSS files. See Zig source for full wire format.
    HotUpdate = b'u',
    /// Sent when the list of errors changes.
    Errors = b'e',
    /// A message from the browser.
    BrowserMessage = b'b',
    /// Sent to clear the messages from `browser_error`
    BrowserMessageClear = b'B',
    /// Sent when a request handler error is emitted.
    RequestHandlerError = b'h',
    /// Payload for `incremental_visualizer.html`.
    Visualizer = b'v',
    /// Payload for `memory_visualizer.html`.
    MemoryVisualizer = b'M',
    /// Sent in response to `set_url`.
    SetUrlResponse = b'n',
    /// Used for synchronization in DevServer tests.
    TestingWatchSynchronization = b'r',
}

impl MessageId {
    #[inline]
    pub fn char(self) -> u8 {
        self as u8
    }
}

/// Avoid changing message ID values, as some of these are hard-coded in tests.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum IncomingMessageId {
    /// Initialization packet.
    Init = b'i',
    /// Subscribe to an event channel.
    Subscribe = b's',
    /// Emitted on client-side navigations.
    SetUrl = b'n',
    /// Tells the DevServer to batch events together.
    TestingBatchEvents = b'H',
    /// Console log from the client
    ConsoleLog = b'l',
    /// Tells the DevServer to unref a source map.
    UnrefSourceMap = b'u',
    // _ => Invalid data — TODO(port): Zig non-exhaustive enum
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ConsoleLogKind {
    Log = b'l',
    Err = b'e',
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum HmrTopic {
    HotUpdate = b'h',
    Errors = b'e',
    BrowserError = b'E',
    IncrementalVisualizer = b'v',
    MemoryVisualizer = b'M',
    TestingWatchSynchronization = b'r',
    // _ => Invalid data — TODO(port): Zig non-exhaustive enum
}

impl HmrTopic {
    pub const MAX_COUNT: usize = 6;
}

bitflags::bitflags! {
    // TODO(port): Zig generated `Bits` via @Type from HmrTopic enum fields.
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
    pub fn route_to_bundle_index_slow(&mut self, pattern: &[u8]) -> Option<route_bundle::Index> {
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

    // BakeSourceProvider.cpp
    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        pub fn BakeGetDefaultExportFromModule(global: *const JSGlobalObject, module: JSValue) -> JSValue;
    }

    pub fn bake_load_server_hmr_patch(global: &JSGlobalObject, code: BunString) -> JsResult<JSValue> {
        unsafe extern "C" {
            fn BakeLoadServerHmrPatch(global: *const JSGlobalObject, code: BunString) -> JSValue;
        }
        // SAFETY: extern "C" FFI; global is a valid &JSGlobalObject
        jsc::from_js_host_call(global, || unsafe { BakeLoadServerHmrPatch(global, code) })
    }

    pub fn bake_load_server_hmr_patch_with_source_map(
        global: &JSGlobalObject,
        code: BunString,
        source_map_json_ptr: *const u8,
        source_map_json_len: usize,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            fn BakeLoadServerHmrPatchWithSourceMap(
                global: *const JSGlobalObject,
                code: BunString,
                ptr: *const u8,
                len: usize,
            ) -> JSValue;
        }
        // SAFETY: extern "C" FFI; global valid, ptr/len describe a valid byte slice
        jsc::from_js_host_call(global, || unsafe {
            BakeLoadServerHmrPatchWithSourceMap(global, code, source_map_json_ptr, source_map_json_len)
        })
    }

    pub fn bake_load_initial_server_code(
        global: &JSGlobalObject,
        code: BunString,
        separate_ssr_graph: bool,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            fn BakeLoadInitialServerCode(
                global: *const JSGlobalObject,
                code: BunString,
                separate_ssr_graph: bool,
            ) -> JSValue;
        }
        // SAFETY: extern "C" FFI; global is a valid &JSGlobalObject
        jsc::from_js_host_call(global, || unsafe {
            BakeLoadInitialServerCode(global, code, separate_ssr_graph)
        })
    }
}

// PERF(port): was comptime monomorphization (`comptime n: comptime_int, bits: [n]*DynamicBitSetUnmanaged`) — profile in Phase B
fn mark_all_route_children(
    router: &FrameworkRouter,
    bits: &mut [&mut DynamicBitSet],
    route_index: framework_router::RouteIndex,
) {
    let mut next = router.route_ptr(route_index).first_child.unwrap_();
    while let Some(child_index) = next {
        let route = router.route_ptr(child_index);
        if let Some(index) = route.bundle.unwrap_() {
            for b in bits.iter_mut() {
                b.set(index.get() as usize);
            }
        }
        mark_all_route_children(router, bits, child_index);
        next = route.next_sibling.unwrap_();
    }
}

impl DevServer {
    fn mark_all_route_children_failed(&mut self, route_index: framework_router::RouteIndex) {
        let mut next = self.router.route_ptr(route_index).first_child.unwrap_();
        while let Some(child_index) = next {
            let route = self.router.route_ptr(child_index);
            if let Some(index) = route.bundle.unwrap_() {
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }
            self.mark_all_route_children_failed(child_index);
            next = route.next_sibling.unwrap_();
        }
    }

    pub fn inspector(&self) -> Option<&mut BunFrontendDevServerAgent> {
        // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
        if let Some(debugger) = unsafe { &*self.vm }.debugger.as_ref() {
            #[cold]
            fn cold() {}
            cold();
            if debugger.frontend_dev_server_agent.is_enabled() {
                cold();
                // TODO(port): returns &mut from &self.vm — Phase B reshape
                // SAFETY: agent has interior mutability in Zig; reshaped in Phase B
                return Some(unsafe {
                    &mut *(&debugger.frontend_dev_server_agent as *const _ as *mut _)
                });
            }
        }
        None
    }

    /// Called on watcher's thread; Access to dev-server state restricted.
    pub fn on_file_update(
        &mut self,
        events: &[bun_watcher::Event],
        changed_files: &[Option<Box<ZStr>>],
        watchlist: bun_watcher::ItemList,
    ) {
        debug_assert!(self.magic == Magic::Valid);
        debug_log!("onFileUpdate start");
        let _end = scopeguard::guard((), |_| debug_log!("onFileUpdate end"));

        let slice = watchlist.slice();
        let file_paths = slice.items_file_path();
        let counts = slice.items_count();
        let kinds = slice.items_kind();

        let ev = self.watcher_atomics.watcher_acquire_event();
        let _release =
            scopeguard::guard((), |_| self.watcher_atomics.watcher_release_and_submit_event(ev));

        let _flush = scopeguard::guard((), |_| self.bun_watcher.flush_evictions());

        for event in events {
            // TODO: why does this out of bounds when you delete every file in the directory?
            if event.index as usize >= file_paths.len() {
                continue;
            }

            let file_path = &file_paths[event.index as usize];
            let update_count = counts[event.index as usize] + 1;
            counts[event.index as usize] = update_count;
            let kind = kinds[event.index as usize];

            debug_log!(
                "{} change: {} {}",
                <&'static str>::from(kind),
                bstr::BStr::new(file_path),
                event.op
            );

            match kind {
                bun_watcher::Kind::File => {
                    if event.op.delete || event.op.rename {
                        // TODO: audit this line heavily
                        self.bun_watcher
                            .remove_at_index(event.index, 0, &[], bun_watcher::Kind::File);
                    }

                    ev.append_file(file_path);
                }
                bun_watcher::Kind::Directory => {
                    #[cfg(target_os = "linux")]
                    {
                        // INotifyWatcher stores sub paths into `changed_files`
                        let names = event.names(changed_files);
                        if !names.is_empty() {
                            for maybe_sub_path in names {
                                ev.append_dir(file_path, maybe_sub_path.as_deref());
                            }
                        } else {
                            ev.append_dir(file_path, None);
                        }
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        ev.append_dir(file_path, None);
                    }
                }
            }
        }
    }

    pub fn on_watch_error(&self, err: sys::Error) {
        if !err.path.is_empty() {
            Output::err(
                err,
                format_args!(
                    "failed to watch {:?} for hot-reloading",
                    bun_core::fmt::quote(&err.path)
                ),
            );
        } else {
            Output::err(err, "failed to watch files for hot-reloading");
        }
        Output::warn(
            "The development server is still running, but hot-reloading is disabled until a restart.",
        );
        // TODO: attempt to automatically restart the watcher thread, perhaps wait for next request.
    }

    pub fn publish(&self, topic: HmrTopic, message: &[u8], opcode: Opcode) {
        if let Some(s) = &self.server {
            let _ = s.publish(&[topic as u8], message, opcode, false);
        }
    }

    pub fn num_subscribers(&self, topic: HmrTopic) -> u32 {
        if let Some(s) = &self.server {
            s.num_subscribers(&[topic as u8])
        } else {
            0
        }
    }
}

// TODO(port): packed struct(u32) with non-bool fields → repr(transparent) + manual accessors
#[repr(transparent)]
#[derive(Copy, Clone)]
struct SafeFileId(u32);
impl SafeFileId {
    fn new(side: bake::Side, index: u32) -> Self {
        SafeFileId((side as u32) | (index << 1))
    }
    fn side(self) -> bake::Side {
        // SAFETY: low bit is always a valid bake::Side discriminant
        unsafe { core::mem::transmute((self.0 & 1) as u8) }
    }
    fn index(self) -> u32 {
        (self.0 >> 1) & 0x3FFF_FFFF
    }
}

impl DevServer {
    /// Interface function for FrameworkRouter
    pub fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: framework_router::RouteIndex,
        file_kind: framework_router::RouteFileKind,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        let index = self.server_graph.insert_stale_extra(abs_path, false, true)?;
        self.route_lookup.put(
            index,
            RouteIndexAndRecurseFlag {
                route_index: associated_route,
                should_recurse_when_visiting: file_kind == framework_router::RouteFileKind::Layout,
            },
        )?;
        Ok(to_opaque_file_id::<{ bake::Side::Server }>(index))
    }

    pub fn on_router_syntax_error(
        &self,
        rel_path: &[u8],
        log: framework_router::TinyLog,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        log.print(rel_path);
        Ok(())
    }

    pub fn on_router_collision_error(
        &self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: framework_router::RouteFileKind,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        Output::err_generic(format_args!(
            "Multiple {} matching the same route pattern is ambiguous",
            match ty {
                framework_router::RouteFileKind::Page => "pages",
                framework_router::RouteFileKind::Layout => "layout",
            }
        ));
        Output::pretty_errorln(format_args!("  - <blue>{}<r>", bstr::BStr::new(rel_path)));
        let buf = paths::path_buffer_pool().get();
        Output::pretty_errorln(format_args!(
            "  - <blue>{}<r>",
            bstr::BStr::new(self.relative_path(
                &mut *buf,
                &self.server_graph.bundled_files.keys()
                    [from_opaque_file_id::<{ bake::Side::Server }>(other_id).get() as usize]
            ))
        ));
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

fn from_opaque_file_id<const SIDE: bake::Side>(id: OpaqueFileId) -> incremental_graph::FileIndex<SIDE> {
    if cfg!(debug_assertions) {
        let safe = SafeFileId(id.get());
        debug_assert!(SIDE == safe.side());
        return incremental_graph::FileIndex::init(safe.index());
    }
    incremental_graph::FileIndex::init(u32::try_from(id.get()).unwrap())
}

impl DevServer {
    /// Returns posix style path, suitible for URLs and reproducible hashes.
    /// The caller must provide a PathBuffer from the pool.
    pub fn relative_path<'a>(&self, relative_path_buf: &'a mut PathBuffer, path: &'a [u8]) -> &'a [u8] {
        debug_assert!(self.root[self.root.len() - 1] != b'/');

        if !paths::is_absolute(path) {
            return path;
        }

        if path.len() >= self.root.len() + 1
            && path[self.root.len()] == b'/'
            && path.starts_with(&self.root)
        {
            return &path[self.root.len() + 1..];
        }

        let rel = paths::relative_platform_buf(relative_path_buf, &self.root, path, paths::Style::Auto, true);
        // SAFETY: `rel` is owned by relative_path_buf, which is mutable
        paths::platform_to_posix_in_place(unsafe {
            core::slice::from_raw_parts_mut(rel.as_ptr() as *mut u8, rel.len())
        });
        rel
    }

    /// Either of two conditions make this true:
    /// - The inspector is enabled
    /// - The user passed "console": true in serve options
    fn should_receive_console_log_from_browser(&self) -> bool {
        self.inspector().is_some() || self.broadcast_console_log_from_browser_to_server
    }
}

fn dump_state_due_to_crash(dev: &mut DevServer) -> Result<(), bun_core::Error> {
    const _: () = assert!(cfg!(feature = "bake_debugging_features"));

    // being conservative about how much stuff is put on the stack.
    let mut filepath_buf = [0u8; if 4096 < MAX_PATH_BYTES { 4096 } else { MAX_PATH_BYTES }];
    let filepath = {
        let mut cursor = &mut filepath_buf[..];
        let _ = write!(
            cursor,
            "incremental-graph-crash-dump.{}.html\0",
            bun_core::time::timestamp()
        );
        // TODO(port): bufPrintZ; falls back to literal on failure
        ZStr::from_bytes_until_nul(&filepath_buf)
            .unwrap_or_else(|_| ZStr::from_static("incremental-graph-crash-dump.html"))
    };
    // TODO(port): std.fs.cwd().createFileZ — use bun_sys
    let file = match sys::File::create(sys::Fd::cwd(), filepath) {
        Ok(f) => f,
        Err(err) => {
            Output::warn(format_args!(
                "Could not open file for dumping incremental graph: {}",
                err
            ));
            return Ok(());
        }
    };

    // TODO(port): comptime brk: { @setEvalBranchQuota; @embedFile; lastIndexOf }
    const VISUALIZER: &[u8] = include_bytes!("incremental_visualizer.html");
    // TODO(port): const split at compile time — Phase B
    let i = strings::last_index_of(VISUALIZER, b"<script>").unwrap() + b"<script>".len();
    let (start, end) = (&VISUALIZER[..i], &VISUALIZER[i..]);

    file.write_all(start)?;
    file.write_all(b"\nlet inlinedData = Uint8Array.from(atob(\"")?;

    // PERF(port): was stack-fallback (4096)
    let mut payload: Vec<u8> = Vec::with_capacity(4096);
    dev.write_visualizer_message(&mut payload)?;

    let mut buf = [0u8; bun_base64::encode_len_from_size(4096)];
    for chunk in payload.chunks(4096) {
        file.write_all(&buf[..bun_base64::encode(&mut buf, chunk)])?;
    }

    file.write_all(b"\"), c => c.charCodeAt(0));\n")?;
    file.write_all(end)?;

    Output::note(format_args!(
        "Dumped incremental bundler graph to {:?}",
        bun_core::fmt::quote(filepath.as_bytes())
    ));
    Ok(())
}

// TODO(port): packed struct(u32) — Route.Index is 31 bits + 1 bool bit
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct RouteIndexAndRecurseFlag(u32);
impl RouteIndexAndRecurseFlag {
    pub fn route_index(self) -> framework_router::RouteIndex {
        framework_router::RouteIndex::init(self.0 & 0x7FFF_FFFF)
    }
    pub fn should_recurse_when_visiting(self) -> bool {
        (self.0 >> 31) != 0
    }
    // TODO(port): field-style construction was used; provide ctor
}
// TODO(port): Zig field-init `.{ .route_index = .., .should_recurse_when_visiting = .. }`
// is used throughout; Phase B should add a `new()` and update callsites.

/// Bake needs to specify which graph (client/server/ssr) each entry point is.
pub struct EntryPointList {
    pub set: ArrayHashMap<Box<[u8]>, entry_point_list::Flags>,
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
        }
    }
}

impl EntryPointList {
    pub const EMPTY: EntryPointList = EntryPointList { set: ArrayHashMap::new() };

    pub fn append_js(&mut self, abs_path: &[u8], side: bake::Graph) -> Result<(), bun_core::Error> {
        self.append(
            abs_path,
            match side {
                bake::Graph::Server => entry_point_list::Flags::SERVER,
                bake::Graph::Client => entry_point_list::Flags::CLIENT,
                bake::Graph::Ssr => entry_point_list::Flags::SSR,
            },
        )
    }

    pub fn append_css(&mut self, abs_path: &[u8]) -> Result<(), bun_core::Error> {
        self.append(abs_path, entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS)
    }

    /// Deduplictes requests to bundle the same file twice.
    pub fn append(&mut self, abs_path: &[u8], flags: entry_point_list::Flags) -> Result<(), bun_core::Error> {
        let gop = self.set.get_or_put(abs_path)?;
        if gop.found_existing {
            *gop.value |= flags;
        } else {
            *gop.value = flags;
        }
        Ok(())
    }
}

/// This structure does not increment the reference count of its contents, as
/// the lifetime of them are all tied to the underling Bun.serve instance.
pub struct HTMLRouter<'a> {
    pub map: StringHashMap<&'a HTMLBundle::HTMLBundleRoute>,
    /// If a catch-all route exists, it is not stored in map, but here.
    pub fallback: Option<&'a HTMLBundle::HTMLBundleRoute>,
}

impl<'a> HTMLRouter<'a> {
    pub const EMPTY: HTMLRouter<'a> = HTMLRouter { map: StringHashMap::new(), fallback: None };

    pub fn get(&self, path: &[u8]) -> Option<&'a HTMLBundle::HTMLBundleRoute> {
        self.map.get(path).copied().or(self.fallback)
    }

    pub fn put(
        &mut self,
        path: &[u8],
        route: &'a HTMLBundle::HTMLBundleRoute,
    ) -> Result<(), bun_core::Error> {
        if path == b"/*" {
            self.fallback = Some(route);
        } else {
            self.map.put(path, route)?;
        }
        Ok(())
    }

    pub fn clear(&mut self) {
        self.map.clear();
        self.fallback = None;
    }
}

// HTMLRouter::deinit → Drop on map

impl DevServer {
    pub fn put_or_overwrite_asset(
        &mut self,
        path: &bun_fs::Path,
        contents: &Blob::Any,
        content_hash: u64,
    ) -> Result<(), bun_core::Error> {
        self.graph_safety_lock.lock();
        let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());
        let _ = self.assets.replace_path(
            &path.text,
            contents,
            &MimeType::by_extension(path.name.ext_without_leading_dot()),
            content_hash,
        )?;
        Ok(())
    }

    pub fn on_plugins_resolved(
        &mut self,
        plugins: Option<*mut JSBundler::Plugin>,
    ) -> Result<(), bun_core::Error> {
        self.bundler_options.plugin = plugins;
        self.plugin_state = PluginState::Loaded;
        self.start_next_bundle_if_present();
        Ok(())
    }

    pub fn on_plugins_rejected(&mut self) -> Result<(), bun_core::Error> {
        self.plugin_state = PluginState::Err;
        while let Some(item) = self.next_bundle.requests.pop_first() {
            item.data.abort();
            item.data.deref_();
        }
        self.next_bundle.route_queue.clear();
        // TODO: allow recovery from this state
        Ok(())
    }
}

/// Problem statement documented on `SCRIPT_UNREF_PAYLOAD`
/// Takes 8 bytes: The generation ID in hex.
struct UnrefSourceMapRequest<'a> {
    dev: &'a mut DevServer,
    body: uws::BodyReaderMixin<Self>, // TODO(port): BodyReaderMixin(@This(), "body", runWithBody, finalize)
}

impl<'a> UnrefSourceMapRequest<'a> {
    fn run<R>(dev: &mut DevServer, _: &mut Request, resp: &mut R)
    where
        R: uws::ResponseLike,
    {
        let ctx = Box::new(UnrefSourceMapRequest {
            dev,
            body: uws::BodyReaderMixin::init(),
        });
        ctx.dev.server.as_ref().unwrap().on_pending_request();
        ctx.body.read_body(resp);
        // TODO(port): ctx is leaked into the body reader; freed in finalize()
        Box::into_raw(ctx);
    }

    fn finalize(ctx: *mut UnrefSourceMapRequest) {
        // SAFETY: ctx was Box::into_raw'd in run()
        let ctx = unsafe { Box::from_raw(ctx) };
        ctx.dev.server.as_ref().unwrap().on_static_request_complete();
        drop(ctx);
    }

    fn run_with_body(
        ctx: &mut UnrefSourceMapRequest,
        body: &[u8],
        r: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        if body.len() != 8 {
            return Err(bun_core::err!(InvalidRequest));
        }
        let mut generation_bytes = [0u8; 4];
        bun_core::fmt::hex_to_bytes(&mut generation_bytes, body)
            .map_err(|_| bun_core::err!(InvalidRequest))?;
        let generation = u32::from_ne_bytes(generation_bytes);
        let source_map_key = source_map_store::Key::init((generation as u64) << 32);
        let _ = ctx
            .dev
            .source_maps
            .remove_or_upgrade_weak_ref(source_map_key, source_map_store::WeakRefAction::Remove);
        r.write_status("204 No Content");
        r.end("", false);
        Ok(())
    }
}

pub fn read_string32<R: bun_io::Read>(reader: &mut R) -> Result<Box<[u8]>, bun_core::Error> {
    let len = reader.read_u32_le()?;
    let mut memory = vec![0u8; len as usize].into_boxed_slice();
    reader.read_no_eof(&mut memory)?;
    Ok(memory)
}

pub struct TestingBatch {
    /// Keys are borrowed. See doc comment in Zig source.
    pub entry_points: EntryPointList,
}

impl TestingBatch {
    pub const EMPTY: TestingBatch = TestingBatch { entry_points: EntryPointList::EMPTY };

    pub fn append(
        &mut self,
        _dev: &DevServer,
        entry_points: &EntryPointList,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(!entry_points.set.is_empty());
        for (k, v) in entry_points.set.keys().iter().zip(entry_points.set.values()) {
            self.entry_points.append(k, *v)?;
        }
        Ok(())
    }
}

/// `test/bake/deinitialization.test.ts` checks for this as well as all tests
/// using the dev server test harness.
static DEV_SERVER_DEINIT_COUNT_FOR_TESTING: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);
pub fn get_deinit_count_for_testing() -> usize {
    DEV_SERVER_DEINIT_COUNT_FOR_TESTING.load(core::sync::atomic::Ordering::Relaxed)
}

struct PromiseEnsureRouteBundledCtx<'a> {
    dev: &'a mut DevServer,
    global: &'a JSGlobalObject,
    promise: Option<jsc::JSPromiseStrong>,
    p: Option<*mut jsc::JSPromise>, // BORROW_FIELD: from sibling self.promise
    already_loaded: bool,
    route_bundle_index: route_bundle::Index,
}

impl<'a> PromiseEnsureRouteBundledCtx<'a> {
    fn ensure_promise(&mut self) -> jsc::JSPromiseStrong {
        if let Some(p) = &self.promise {
            return p.clone();
        }
        let strong = jsc::JSPromiseStrong::init(self.global);
        self.promise = Some(strong.clone());
        self.p = Some(strong.get());
        strong
    }

    fn on_defer(&mut self, bundle_field: BundleQueueType) -> JsResult<()> {
        match bundle_field {
            BundleQueueType::CurrentBundle => {
                let cb = self.dev.current_bundle.as_mut().unwrap();
                if cb.promise.strong.has_value() {
                    cb.promise
                        .route_bundle_indices
                        .put(self.route_bundle_index, ())
                        .expect("oom");
                    self.p = Some(cb.promise.strong.get());
                    return Ok(());
                }
                let strong_promise = self.ensure_promise();
                let cb = self.dev.current_bundle.as_mut().unwrap();
                cb.promise
                    .route_bundle_indices
                    .put(self.route_bundle_index, ())
                    .expect("oom");
                cb.promise.strong = strong_promise;
                Ok(())
            }
            BundleQueueType::NextBundle => {
                if self.dev.next_bundle.promise.strong.has_value() {
                    self.dev
                        .next_bundle
                        .promise
                        .route_bundle_indices
                        .put(self.route_bundle_index, ())
                        .expect("oom");
                    self.p = Some(self.dev.next_bundle.promise.strong.get());
                    return Ok(());
                }
                let strong_promise = self.ensure_promise();
                self.dev
                    .next_bundle
                    .promise
                    .route_bundle_indices
                    .put(self.route_bundle_index, ())
                    .expect("oom");
                self.dev.next_bundle.promise.strong = strong_promise;
                Ok(())
            }
        }
    }

    fn on_loaded(&mut self) -> JsResult<()> {
        let _ = self.ensure_promise();
        // SAFETY: p was set by ensure_promise
        unsafe { &mut *self.p.unwrap() }.resolve(self.global, JSValue::TRUE)?;
        // SAFETY: dev.vm is JSC_BORROW — valid for DevServer lifetime
        unsafe { &*self.dev.vm }.drain_microtasks();
        Ok(())
    }

    fn on_failure(&mut self) -> JsResult<()> {
        let promise_response = PromiseResponse {
            promise: self.ensure_promise(),
            global: self.global,
        };

        let failure = self
            .dev
            .route_bundle_ptr(self.route_bundle_index)
            .data
            .framework()
            .evaluate_failure
            .as_ref()
            .unwrap();
        let failures = core::slice::from_ref(failure);
        self.dev.send_serialized_failures(
            DevResponse::Promise(promise_response),
            failures,
            ErrorPageKind::Evaluation,
            None,
        )
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        let _ = self.ensure_promise();
        // SAFETY: p was set by ensure_promise
        unsafe { &mut *self.p.unwrap() }
            .reject(self.global, BunString::static_("Plugin error").to_js(self.global))?;
        // SAFETY: dev.vm is JSC_BORROW — valid for DevServer lifetime
        unsafe { &*self.dev.vm }.drain_microtasks();
        Ok(())
    }

    fn to_dev_response(&mut self) -> DevResponse {
        DevResponse::Promise(PromiseResponse {
            promise: self.ensure_promise(),
            global: self.global,
        })
    }
}

#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bake__bundleNewRouteJSFunctionImpl(
    global: &JSGlobalObject,
    request_ptr: *mut c_void,
    url: BunString,
) -> JSValue {
    jsc::to_js_host_call(global, || bundle_new_route_js_function_impl(global, request_ptr, url))
}

fn bundle_new_route_js_function_impl(
    global: &JSGlobalObject,
    request_ptr: *mut c_void,
    url_bunstr: BunString,
) -> JsResult<JSValue> {
    let url = url_bunstr.to_utf8();

    // SAFETY: request_ptr is a *bun.webcore.Request from C++
    let request: &mut WebRequest = unsafe { &mut *(request_ptr as *mut WebRequest) };
    let Some(dev) = request.request_context.dev_server() else {
        return Err(global.throw("Request context does not belong to dev server", &[]));
    };
    // Extract pathname from URL (remove protocol, host, query, hash)
    let pathname = extract_pathname_from_url(url.byte_slice());

    if pathname.is_empty() || pathname[0] != b'/' {
        return Err(global.throw(
            format_args!(
                "Invalid path \"{}\" it should be non-empty and start with a slash",
                bstr::BStr::new(pathname)
            ),
            &[],
        ));
    }

    let mut params: framework_router::MatchedParams = Default::default();
    let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
        return Err(global.throw(
            format_args!("No route found for path: {}", bstr::BStr::new(pathname)),
            &[],
        ));
    };

    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
    let vm = unsafe { &*dev.vm };
    vm.event_loop().enter();
    let _exit = scopeguard::guard((), |_| vm.event_loop().exit());

    let mut ctx = PromiseEnsureRouteBundledCtx {
        dev,
        global,
        promise: None,
        p: None,
        already_loaded: false,
        route_bundle_index: dev
            .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
            .expect("oom"),
    };

    let rbi = ctx.route_bundle_index;
    ensure_route_is_bundled(dev, rbi, &mut ctx)?;

    let array = JSValue::create_empty_array(global, 2)?;

    array.put_index(global, 0, JSValue::js_number_from_u64(rbi.get() as u64))?;

    if ctx.p.is_none() {
        array.put_index(global, 1, JSValue::UNDEFINED)?;
        return Ok(array);
    }

    debug_assert!(ctx.p.is_some());
    // SAFETY: p was set above
    array.put_index(global, 1, unsafe { &*ctx.p.unwrap() }.to_js())?;

    Ok(array)
}

// TODO(port): move to <area>_sys; callconv(jsc.conv)
unsafe extern "C" {
    fn Bake__createDevServerFrameworkRequestArgsObject(
        global: *const JSGlobalObject,
        router_type_main: JSValue,
        route_modules: JSValue,
        client_entry_url: JSValue,
        styles: JSValue,
        params: JSValue,
    ) -> JSValue;
}

pub fn create_dev_server_framework_request_args_object(
    global: &JSGlobalObject,
    router_type_main: JSValue,
    route_modules: JSValue,
    client_entry_url: JSValue,
    styles: JSValue,
    params: JSValue,
) -> JsResult<JSValue> {
    // SAFETY: extern "C" FFI; global is a valid &JSGlobalObject; JSValue args are stack-rooted
    jsc::from_js_host_call(global, || unsafe {
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

#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub extern "C" fn Bake__getNewRouteParamsJSFunctionImpl(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    jsc::to_js_host_call(global, || {
        new_route_params_for_bundle_promise_for_js(global, callframe)
    })
}

fn new_route_params_for_bundle_promise_for_js(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    if callframe.arguments_count() != 3 {
        return Err(global.throw("Expected 3 arguments", &[]));
    }

    let request_js = callframe.argument(0);
    let route_bundle_index_js = callframe.argument(1);
    let url_js = callframe.argument(2);

    if !request_js.is_object() {
        return Err(global.throw("Request must be an object", &[]));
    }
    if !route_bundle_index_js.is_integer() {
        return Err(global.throw("Route bundle index must be an integer", &[]));
    }
    if !url_js.is_string() {
        return Err(global.throw("URL must be a string", &[]));
    }

    let Some(request) = request_js.as_::<WebRequest>() else {
        return Err(global.throw("Request must be a Request object", &[]));
    };
    let Some(dev) = request.request_context.dev_server() else {
        return Err(global.throw("Request context does not belong to dev server", &[]));
    };

    let route_bundle_index =
        route_bundle::Index::init(u32::try_from(route_bundle_index_js.to_i32()).unwrap());

    let url = url_js.to_bun_string(global)?;
    let _deref = scopeguard::guard((), |_| url.deref_());
    let url_utf8 = url.to_utf8();

    new_route_params_for_bundle_promise(dev, route_bundle_index, url_utf8.byte_slice())
}

fn new_route_params_for_bundle_promise(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    url: &[u8],
) -> JsResult<JSValue> {
    let route_bundle = dev.route_bundle_ptr(route_bundle_index);
    let framework_bundle = route_bundle.data.framework_mut();

    let pathname = extract_pathname_from_url(url);

    // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
    let global = unsafe { &*(*dev.vm).global };
    let mut params: framework_router::MatchedParams = Default::default();
    let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
        return Err(global.throw(
            format_args!("No route found for path: {}", bstr::BStr::new(pathname)),
            &[],
        ));
    };
    if route_index != framework_bundle.route_index {
        return Err(global.throw(
            format_args!(
                "Route index mismatch, expected {} but got {}",
                framework_bundle.route_index.get(),
                route_index.get()
            ),
            &[],
        ));
    }
    let params_js_value = params.to_js(global);

    let args = dev.compute_arguments_for_framework_request(
        route_bundle_index,
        framework_bundle,
        params_js_value,
        false,
    )?;

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
        let path_with_query = &pathname[path_start..];
        // Remove query string and hash
        let query_index =
            strings::index_of_char(path_with_query, b'?').unwrap_or(path_with_query.len());
        let hash_index =
            strings::index_of_char(path_with_query, b'#').unwrap_or(path_with_query.len());
        let end = query_index.min(hash_index);
        pathname = &path_with_query[..end];
    }

    pathname
}

// Type aliases referenced throughout (Phase B will resolve to real paths)
use crate::dev_server::route_bundle;
use crate::dev_server::serialized_failure;
use crate::dev_server::source_map_store;
use crate::dev_server::incremental_graph;
type DebuggerId = jsc::debugger::DebuggerId;
type BunFrontendDevServerAgent = jsc::debugger::BunFrontendDevServerAgent;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer.zig (4783 lines)
//   confidence: low
//   todos:      76
//   notes:      Heavy borrowck reshaping needed in Phase B: init() has late-init fields (todo!() placeholders — must use MaybeUninit<DevServer> or pre-construct); DevServer/HTMLRouter/PromiseResponse now carry `<'a>` per LIFETIMES.tsv but impl blocks still need the param threaded; many scopeguard closures capture &mut dev across other &mut borrows; finalize_bundle has self-referential ptrs into dev. ensure_route_is_bundled uses trait pattern for Zig comptime Ctx duck-typing. Several `anytype` params (set_routes, on_request, on_src_request) bound by placeholder traits.
// ──────────────────────────────────────────────────────────────────────────
