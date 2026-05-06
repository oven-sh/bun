//! Instance of the development server. Attaches to an instance of `Bun.serve`,
//! controlling bundler, routing, and hot module reloading.
//!
//! Reprocessing files that did not change is banned; by having perfect
//! incremental tracking over the project, editing a file's contents (asides
//! adjusting imports) must always rebundle only that one file.
//!
//! All work is held in-memory, using manually managed data-oriented design.
//! For questions about DevServer, please consult the delusional @paperclover

#![allow(unexpected_cfgs)] // `feature = "bake_debugging_features"` mirrors Zig `bun.FeatureFlags.bake_debugging_features`; not yet a declared cargo feature.

use ::core::ffi::c_void;
use ::core::mem::offset_of;
use std::io::Write as _;
use std::time::Instant;

use bun_alloc::{AllocError, Arena};
use crate::allocators::allocation_scope::BumpAllocatorExt as _;
use bun_collections::{ArrayHashMap, AutoBitSet, DynamicBitSet, HashMap, HiveArray, StringHashMap};
use bun_core::{self as core, Environment, Output};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, StringJsc as _,
};
use bun_bundler::Graph::InputFileListExt as _;
use bun_bundler::linker_graph::FileListExt as _;
use bun_bundler::options_impl::TargetExt as _;
use bun_js_parser::ast::bundled_ast::BundledAstListExt as _;
use bun_js_parser::ast::server_component_boundary::ServerComponentBoundarySliceExt as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_logger::Log;
use bun_paths::{self as paths, PathBuffer, MAX_PATH_BYTES};
use bun_str::{self as str, strings, String as BunString, ZStr};
use bun_jsc::StringJsc as _;
use bun_sys as sys;
use bun_watcher::WatchItemColumns as _;
use bun_uws::{self as uws, AnyResponse, Opcode, Request, WebSocketBehavior, WebSocketUpgradeContext};
use bun_wyhash::{hash, Wyhash};

use crate::bake;
use crate::bake::framework_router::{self as framework_router, FrameworkRouter, OpaqueFileId, Route};
use bun_bundler::{self as bundler, options::Loader, BundleV2, Transpiler};
use bun_http::{Method, MimeType};
use bun_options_types::{ImportKind, ImportRecord};
use crate::api::server::StaticRoute;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use crate::api::{AnyServer, HTMLBundle, JSBundler, SavedRequest};
use crate::server::html_bundle::HTMLBundleRoute;
use crate::webcore::{Blob, Request as WebRequest, Response};
use bun_safety::ThreadLock;
use bun_sourcemap::SourceMap;
use bun_watcher::Watcher;

pub use crate::bake::dev_server::assets::Assets;
pub use crate::bake::dev_server::DirectoryWatchStore;
// TODO(port): ErrorReportRequest body lives in the gated draft; stub until un-gated.
pub struct ErrorReportRequest;
impl ErrorReportRequest {
    fn run<R>(_dev: &mut DevServer, _req: &mut Request, _resp: &mut R) {
        todo!("blocked_on: ErrorReportRequest");
    }
}
pub use crate::bake::dev_server::HmrSocket;
use crate::bake::dev_server::ResponseLike;

// ── local extension shims for upstream-crate methods missing in Rust port ──
/// Shim: Zig `JSPromise.Strong.deinit()` — explicit teardown (idempotent).
trait JsPromiseStrongDeinitExt {
    fn deinit(&mut self);
}
impl JsPromiseStrongDeinitExt for jsc::JSPromiseStrong {
    fn deinit(&mut self) {
        // PORT NOTE: `JSPromiseStrong` has no explicit `deinit`; replacing with
        // an empty value drops the inner `Strong`, mirroring Zig's clear+deinit.
        *self = jsc::JSPromiseStrong::empty();
    }
}
/// Shim: `bake.Framework` methods that live on the duplicate
/// `bake_body::Framework` shape — stubbed until the two structs unify.
trait FrameworkInitTranspilerExt {
    fn init_transpiler<'a>(
        &mut self,
        _arena: &'a Arena,
        _log: &mut Log,
        _mode: bake::Mode,
        _renderer: bake::Graph,
        _out: &mut ::core::mem::MaybeUninit<Transpiler<'a>>,
        _opts: &bake::BuildConfigSubset,
    ) -> Result<(), bun_core::Error>;
    fn resolve(
        &self,
        _server: &mut bun_resolver::Resolver,
        _client: &mut bun_resolver::Resolver,
        _arena: &Arena,
    ) -> Result<bake::Framework, bun_core::Error>;
}
impl FrameworkInitTranspilerExt for bake::Framework {
    fn init_transpiler<'a>(
        &mut self,
        _arena: &'a Arena,
        _log: &mut Log,
        _mode: bake::Mode,
        _renderer: bake::Graph,
        _out: &mut ::core::mem::MaybeUninit<Transpiler<'a>>,
        _opts: &bake::BuildConfigSubset,
    ) -> Result<(), bun_core::Error> {
        todo!("blocked_on: bake::Framework / bake_body::Framework unification (init_transpiler)")
    }
    fn resolve(
        &self,
        _server: &mut bun_resolver::Resolver,
        _client: &mut bun_resolver::Resolver,
        _arena: &Arena,
    ) -> Result<bake::Framework, bun_core::Error> {
        todo!("blocked_on: bake::Framework / bake_body::Framework unification (resolve)")
    }
}
/// Shim: `bun_logger::Log::to_js_aggregate_error` (lives in logger_jsc, not yet ported).
trait LogToJsAggregateErrorExt {
    fn to_js_aggregate_error(
        &mut self,
        _global: &JSGlobalObject,
        _msg: BunString,
    ) -> JsResult<JSValue>;
}
impl LogToJsAggregateErrorExt for Log {
    fn to_js_aggregate_error(
        &mut self,
        _global: &JSGlobalObject,
        _msg: BunString,
    ) -> JsResult<JSValue> {
        todo!("blocked_on: bun_logger::Log::to_js_aggregate_error")
    }
}
pub use crate::bake::dev_server::HotReloadEvent;
pub use crate::bake::dev_server::incremental_graph::IncrementalGraph;
// TODO(port): memory_cost helpers live in the gated draft; stub the two referenced.
impl DevServer<'_> {
    fn memory_cost(&self) -> usize { todo!("blocked_on: memory_cost") }
    fn memory_cost_detailed(&self) -> () { todo!("blocked_on: memory_cost_detailed") }
}
pub use crate::bake::dev_server::packed_map::PackedMap;
pub use crate::bake::dev_server::route_bundle::RouteBundle;
pub use crate::bake::dev_server::serialized_failure::SerializedFailure;
pub use crate::bake::dev_server::source_map_store::SourceMapStore;
pub use crate::bake::dev_server::WatcherAtomics;

bun_output::declare_scope!(DevServer, visible);
bun_output::declare_scope!(IncrementalGraph, visible);
bun_output::declare_scope!(SourceMapStore, visible);

// TODO(port): `debug` was a Scoped struct (capital S); the macro form differs.
// NOTE: `scoped_log!` takes an `ident`, so we alias the static via a local `use` in a
// block — this lets call sites use `debug_log!` even when `DevServer`/`IncrementalGraph`/
// `SourceMapStore` is shadowed by a module/type alias at the call site (e.g. IncrementalGraph.rs).
macro_rules! debug_log {
    ($($t:tt)*) => {{
        #[allow(unused_imports)]
        use $crate::bake::dev_server_body::DevServer as __DevServerScope;
        bun_output::scoped_log!(__DevServerScope, $($t)*)
    }};
}
macro_rules! ig_log {
    ($($t:tt)*) => {{
        #[allow(unused_imports)]
        use $crate::bake::dev_server_body::IncrementalGraph as __IgScope;
        bun_output::scoped_log!(__IgScope, $($t)*)
    }};
}
macro_rules! map_log {
    ($($t:tt)*) => {{
        #[allow(unused_imports)]
        use $crate::bake::dev_server_body::SourceMapStore as __SmsScope;
        bun_output::scoped_log!(__SmsScope, $($t)*)
    }};
}
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

// PORT NOTE: Zig `Options` only had field-level defaults for `dump_sources`
// (`if (Environment.isDebug) ".bake-debug" else null`) and `dump_state_on_crash`
// (`null`). The remaining fields (`arena`, `root`, `vm`, `framework`,
// `bundler_options`, `broadcast_console_log_from_browser_to_server`) are
// required with no sensible zero value, so `Default` is intentionally NOT
// implemented. Callers construct `Options` via struct-literal at the call site
// (see `bake_body.rs::UserOptions::into_dev_server_options`).
impl<'a> Options<'a> {
    /// Zig field default: `if (Environment.isDebug) ".bake-debug" else null`.
    pub const DEFAULT_DUMP_SOURCES: Option<&'static [u8]> =
        if cfg!(debug_assertions) { Some(b".bake-debug") } else { None };
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
pub struct CurrentBundle<'a> {
    pub bv2: Box<BundleV2<'a>>,
    /// Information BundleV2 needs to finalize the bundle
    pub start_data: bundler::bundle_v2::__phase_a_draft::DevServerInput,
    /// Started when the bundle was queued
    pub timer: Instant, // TODO(port): std.time.Timer → Instant; .read() becomes .elapsed()
    /// If any files in this bundle were due to hot-reloading, some extra work
    /// must be done to inform clients to reload routes. When this is false,
    /// all entry points do not have bundles yet.
    pub had_reload_event: bool,
    /// After a bundle finishes, these requests will be continued, either
    /// calling their handler on success or sending the error page on failure.
    /// Owned by `deferred_request_pool` in DevServer.
    pub requests: deferred_request::List<'a>,
    /// Resolution failures are grouped by incremental graph file index.
    /// Unlike parse failures (`handleParseTaskFailure`), the resolution
    /// failures can be created asynchronously, and out of order.
    pub resolution_failure_entries: ArrayHashMap<serialized_failure::OwnerPacked, Log>,

    /// 1. Always make sure to deinit this promise
    /// 2. Always drain microtasks after resolving it
    pub promise: DeferredPromise,
}

pub struct NextBundle<'a> {
    /// A list of `RouteBundle`s which have active requests to bundle it.
    pub route_queue: ArrayHashMap<route_bundle::Index, ()>,
    /// If a reload event exists and should be drained. The information
    /// for this watch event is in one of the `watch_events`
    pub reload_event: Option<*mut HotReloadEvent>, // BORROW_FIELD: ptr into dev.watcher_atomics.events[]
    /// The list of requests that are blocked on this bundle.
    pub requests: deferred_request::List<'a>,

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
    pub html_router: HTMLRouter<'a>,
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
    pub server_transpiler: Transpiler<'a>,
    pub client_transpiler: Transpiler<'a>,
    pub ssr_transpiler: Transpiler<'a>,
    /// The log used by all `server_transpiler`, `client_transpiler` and `ssr_transpiler`.
    /// Note that it is rarely correct to write messages into it. Instead, associate
    /// messages with the IncrementalGraph file or Route using `SerializedFailure`
    pub log: Log,
    pub plugin_state: PluginState,
    /// See `CurrentBundle` doc comment.
    pub current_bundle: Option<CurrentBundle<'a>>,
    /// When `current_bundle` is non-null and new requests to bundle come in,
    /// those are temporaried here. When the current bundle is finished, it
    /// will immediately enqueue this.
    pub next_bundle: NextBundle<'a>,
    pub deferred_request_pool: HiveArray<deferred_request::Node<'a>, { DeferredRequest::MAX_PREALLOCATED }>,
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
        self.route_bundle_indices.clear_retaining_capacity();
    }

    pub fn deinit_idempotently(&mut self) {
        self.strong.deinit();
        self.route_bundle_indices = Default::default();
    }
}

/// DevServer is stored on the heap, storing its allocator.
pub fn init(options: Options) -> JsResult<Box<DevServer>> {
    // PORT NOTE: `Features.dev_server +|= 1` (saturating add). AtomicUsize has
    // no `saturating_inc`; on a 64-bit counter overflow is unreachable, so a
    // relaxed `fetch_add(1)` is equivalent in practice.
    bun_core::analytics::Features::DEV_SERVER.fetch_add(1, ::core::sync::atomic::Ordering::Relaxed);

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

    // PORT NOTE: Zig used `bun.new(DevServer, .{ ... = undefined })` then assigned
    // `server_transpiler` / `client_transpiler` / `ssr_transpiler` / `bun_watcher` /
    // `router` / `watcher_atomics` after the heap address was stable. Rust forbids
    // partial struct literals and `mem::zeroed()` here is UB (`Box<Watcher>` is
    // `NonNull`-backed; `Transpiler<'a>` carries `&'a Arena`). The faithful port is
    // `Box::new_uninit()` + per-field `addr_of_mut!().write()`, leaving the
    // `undefined` fields uninitialized until their real values are computed against
    // the stable `*mut DevServer`, then `assume_init()` once every field is written.
    use ::core::mem::MaybeUninit;
    use ::core::ptr::addr_of_mut;

    let mut dev_uninit: Box<MaybeUninit<DevServer>> = Box::new(MaybeUninit::uninit());
    let p: *mut DevServer = dev_uninit.as_mut_ptr();

    /// `addr_of_mut!((*p).$field).write($value)` — writes a single field of the
    /// partially-initialized `DevServer` without materializing `&mut DevServer`.
    macro_rules! w {
        ($field:ident, $value:expr) => {
            addr_of_mut!((*p).$field).write($value)
        };
    }

    // SAFETY: `p` is a freshly-allocated, properly-aligned `*mut DevServer`; each
    // `addr_of_mut!((*p).field)` computes an in-bounds field address without
    // creating a reference to the (partially-uninit) whole. Every field is written
    // exactly once before `assume_init()` below.
    unsafe {
        w!(magic, Magic::Valid);
        // PORT NOTE: `bun_alloc::AllocationScope` is a unit struct stub.
        w!(allocation_scope, AllocationScope);
        w!(root, Box::from(options.root.as_bytes()));
        w!(vm, options.vm);
        w!(server, None);
        w!(directory_watchers, DirectoryWatchStore::default());
        w!(server_fetch_function_callback, jsc::StrongOptional::empty());
        w!(server_register_update_callback, jsc::StrongOptional::empty());
        w!(generation, 0);
        w!(graph_safety_lock, ThreadLock::init_unlocked());
        w!(dump_dir, dump_dir);
        w!(framework, options.framework);
        w!(bundler_options, options.bundler_options);
        w!(emit_incremental_visualizer_events, 0);
        w!(emit_memory_visualizer_events, 0);
        w!(
            memory_visualizer_timer,
            EventLoopTimer::init_paused(EventLoopTimerTag::DevServerMemoryVisualizerTick)
        );
        w!(
            has_pre_crash_handler,
            cfg!(feature = "bake_debugging_features")
                && options
                    .dump_state_on_crash
                    .unwrap_or_else(|| bun_core::env_var::feature_flag::BUN_DUMP_STATE_ON_CRASH.get().unwrap_or(false))
        );
        // `dev.frontend_only = dev.framework.file_system_router_types.len == 0`
        w!(
            frontend_only,
            (*addr_of_mut!((*p).framework))
                .file_system_router_types
                .is_empty()
        );
        w!(client_graph, IncrementalGraph::default());
        w!(server_graph, IncrementalGraph::default());
        w!(barrel_files_with_deferrals, Default::default());
        w!(barrel_needed_exports, Default::default());
        w!(incremental_result, IncrementalResult::EMPTY);
        w!(route_lookup, Default::default());
        w!(route_bundles, Vec::new());
        w!(html_router, HTMLRouter::empty());
        w!(active_websocket_connections, Default::default());
        w!(current_bundle, None);
        w!(
            next_bundle,
            NextBundle {
                route_queue: Default::default(),
                reload_event: None,
                requests: deferred_request::List::default(),
                promise: DeferredPromise::default(),
            }
        );
        w!(inspector_server_id, DebuggerId::new(0)); // TODO paper clover:
        w!(
            assets,
            Assets {
                path_map: Default::default(),
                files: Default::default(),
                refs: Default::default(),
                needs_reindex: false,
            }
        );
        w!(source_maps, SourceMapStore::empty());
        w!(plugin_state, PluginState::Unknown);
        w!(bundling_failures, Default::default());
        w!(
            assume_perfect_incremental_bundling,
            bun_core::env_var::feature_flag::BUN_ASSUME_PERFECT_INCREMENTAL
                .get()
                .unwrap_or(cfg!(debug_assertions))
        );
        w!(testing_batch_events, TestingBatchEvents::Disabled);
        w!(
            broadcast_console_log_from_browser_to_server,
            options.broadcast_console_log_from_browser_to_server
        );
        w!(bundles_since_last_error, 0);
        w!(has_tailwind_plugin_hack, None);
        w!(configuration_hash_key, [0; 16]);
        w!(log, Log::init());
        w!(deferred_request_pool, HiveArray::init());

        // `.router = undefined` — placeholder until the real router is built below
        // (after transpilers + framework.resolve). Constructed empty so the field
        // is valid for `assume_init()`; overwritten by `dev.router = 'router: {..}`.
        w!(
            router,
            FrameworkRouter {
                root: Box::from(options.root.as_bytes()),
                types: Box::new([]),
                routes: Vec::new(),
                static_routes: Default::default(),
                dynamic_routes: Default::default(),
                pattern_arena: Arena::new(),
            }
        );
    }

    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime; `global` is the
    // per-VM `*mut JSGlobalObject`, always non-null once the VM is initialized.
    let global = unsafe { &*options.vm.global };

    let generic_action = "while initializing development server";
    // FileSystem is a process-lifetime singleton; leak the root path to satisfy
    // its `&'static [u8]` parameter (Zig stored a borrowed `[:0]const u8`).
    let root_static: &'static [u8] =
        Box::leak(options.root.as_bytes().to_vec().into_boxed_slice());
    let fs = match bun_resolver::fs::FileSystem::init(Some(root_static)) {
        Ok(fs) => fs,
        Err(err) => return Err(global.throw_error(err, generic_action)),
    };

    // `.bun_watcher = undefined` → `Watcher.init(DevServer, dev, fs, ...)`
    // SAFETY: `Watcher::init` only stores `p` as an opaque `*mut ()` ctx; it does
    // not dereference it until `start()` spawns the watcher thread, by which point
    // every `DevServer` field is initialized (`assume_init` below precedes
    // `bun_watcher.start()`).
    // SAFETY: `FileSystem::init` returns a 'static singleton; reborrow as `&'static`.
    let bun_watcher = match Watcher::init::<DevServer>(p, unsafe { &*fs }) {
        Ok(w) => w,
        Err(err) => {
            return Err(
                global.throw_error(err, "while initializing file watcher for development server"),
            )
        }
    };
    // SAFETY: per-field write into uninit struct; see `w!` SAFETY above.
    unsafe { w!(bun_watcher, bun_watcher) };
    // errdefer dev.bun_watcher.deinit(false) — handled by `Drop for Watcher` when
    // `dev_uninit` is dropped on an error path after `assume_init()`.

    // `.watcher_atomics = undefined` → `WatcherAtomics.init(dev)`
    // SAFETY: `WatcherAtomics::init` / `HotReloadEvent::init_empty` only store `p`
    // as `*const DevServer` for later `concurrent_task.from(dev)`; not dereferenced
    // during construction.
    // PORT NOTE: `WatcherAtomics::init` is typed against `dev_server::DevServer`;
    // cast through the erased pointer while the two struct shapes converge.
    unsafe { w!(watcher_atomics, WatcherAtomics::init(p as *const () as *const crate::bake::dev_server::DevServer)) };

    // This causes a memory leak, but the allocator is otherwise used on multiple threads.
    // (allocator param dropped — global mimalloc)

    // `.server_transpiler/.client_transpiler/.ssr_transpiler = undefined` →
    // `Framework.initTranspiler(..., &dev.X_transpiler, ...)`.
    //
    // SAFETY: `init_transpiler` writes the slot via `MaybeUninit::write` (see
    // `bake_body.rs`), so the previous (uninitialized) bytes are never dropped.
    // `framework`/`log`/`bundler_options` were written above; reborrowing each
    // individually via `addr_of_mut!` is sound because no `&mut DevServer` exists.
    unsafe {
        let framework = &mut *addr_of_mut!((*p).framework);
        let log = &mut *addr_of_mut!((*p).log);
        let bundler_options = &mut *addr_of_mut!((*p).bundler_options);

        if let Err(err) = framework.init_transpiler(
            options.arena,
            log,
            bake::Mode::Development,
            bake::Graph::Server,
            &mut *addr_of_mut!((*p).server_transpiler).cast::<MaybeUninit<Transpiler>>(),
            &bundler_options.server,
        ) {
            return Err(global.throw_error(err, generic_action));
        }
        if let Err(err) = framework.init_transpiler(
            options.arena,
            log,
            bake::Mode::Development,
            bake::Graph::Client,
            &mut *addr_of_mut!((*p).client_transpiler).cast::<MaybeUninit<Transpiler>>(),
            &bundler_options.client,
        ) {
            return Err(global.throw_error(err, generic_action));
        }
        if separate_ssr_graph {
            if let Err(err) = framework.init_transpiler(
                options.arena,
                log,
                bake::Mode::Development,
                bake::Graph::Ssr,
                &mut *addr_of_mut!((*p).ssr_transpiler).cast::<MaybeUninit<Transpiler>>(),
                &bundler_options.ssr,
            ) {
                return Err(global.throw_error(err, generic_action));
            }
        } else {
            // PORT NOTE: Zig left `ssr_transpiler` `undefined` when
            // `!separate_ssr_graph` and never read it. Rust must still write a
            // valid value before `assume_init()`. Bitwise-alias the server
            // transpiler (it is never independently dropped: `Drop for DevServer`
            // does not free transpiler heap fields — see `useAllFields` mapping
            // where `.ssr_transpiler = {}` is a no-op in Zig).
            ::core::ptr::copy_nonoverlapping(
                addr_of_mut!((*p).server_transpiler).cast_const(),
                addr_of_mut!((*p).ssr_transpiler),
                1,
            );
        }
    }

    // ── every field is now written ───────────────────────────────────────────
    // SAFETY: all fields of `*p` were written exactly once above via
    // `addr_of_mut!().write()` / `copy_nonoverlapping`; no field remains uninit.
    let mut dev: Box<DevServer> = unsafe { dev_uninit.assume_init() };
    let dev_ptr: *mut DevServer = &mut *dev;

    // PORT NOTE: Zig asserted `*.owner() == dev` (intrusive parent-ptr derived
    // via `@fieldParentPtr`). The Rust port stores these by value with no back-
    // pointer; the assertion is moot until `owner()` is wired (blocked_on:
    // IncrementalGraph/DirectoryWatchStore::owner).
    let _ = (&dev.server_graph, &dev.client_graph, &dev.directory_watchers);

    dev.graph_safety_lock.lock();
    let _unlock = scopeguard::guard((), |_| dev.graph_safety_lock.unlock());
    // TODO(port): scopeguard captures &mut dev; Phase B reshaping needed.

    if let Err(err) = dev.bun_watcher.start() {
        return Err(global.throw_error(
            err,
            "while initializing file watcher thread for development server",
        ));
    }

    dev.server_transpiler.options.dev_server = dev_ptr as *const ();
    dev.client_transpiler.options.dev_server = dev_ptr as *const ();

    dev.server_transpiler.resolver.watcher = Some(dev.bun_watcher.get_resolve_watcher());
    dev.client_transpiler.resolver.watcher = Some(dev.bun_watcher.get_resolve_watcher());

    if separate_ssr_graph {
        dev.ssr_transpiler.options.dev_server = dev_ptr as *const ();
        dev.ssr_transpiler.resolver.watcher = Some(dev.bun_watcher.get_resolve_watcher());
    }

    debug_assert!(dev.server_transpiler.resolver.opts.target != bundler::options::Target::Browser);
    debug_assert!(dev.client_transpiler.resolver.opts.target == bundler::options::Target::Browser);

    dev.framework = match dev.framework.resolve(
        &mut dev.server_transpiler.resolver,
        &mut dev.client_transpiler.resolver,
        options.arena,
    ) {
        Ok(f) => f,
        Err(_) => {
            if dev.framework.is_built_in_react {
                // TODO(port): blocked_on: bake::Framework / bake_body::Framework unification
                // — `add_react_install_command_note` lives on `bake_body::Framework`.
                let _ = &mut dev.log;
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
            .unwrap_or_else(|e| Output::panic(format_args!("unhandled {}", e)));
            bun_core::write_any_to_hasher(&mut h, &stat.mtime());
            h.update(crate::bake::bake_body::get_hmr_runtime(bake::Side::Client).code);
            h.update(crate::bake::bake_body::get_hmr_runtime(bake::Side::Server).code);
        } else {
            h.update(Environment::GIT_SHA_SHORT.as_bytes());
        }

        for fsr in &dev.framework.file_system_router_types {
            bun_core::write_any_to_hasher(&mut h, &(fsr.allow_layouts as u8));
            bun_core::write_any_to_hasher(&mut h, &(fsr.ignore_underscores as u8));
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
            bun_core::write_any_to_hasher(&mut h, &1u8);
            bun_core::write_any_to_hasher(&mut h, &(sc.separate_ssr_graph as u8));
            h.update(&sc.client_register_server_reference);
            h.update(&[0]);
            h.update(&sc.server_register_client_reference);
            h.update(&[0]);
            h.update(&sc.server_register_server_reference);
            h.update(&[0]);
            h.update(&sc.server_runtime_import);
            h.update(&[0]);
        } else {
            bun_core::write_any_to_hasher(&mut h, &0u8);
        }

        if let Some(rfr) = &dev.framework.react_fast_refresh {
            bun_core::write_any_to_hasher(&mut h, &1u8);
            h.update(&rfr.import_source);
        } else {
            bun_core::write_any_to_hasher(&mut h, &0u8);
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
            // Zig: `@intFromEnum(v)` for the active tag, then `switch (v) { inline else => |data| data }`
            // for the payload. `bun_bundler::bake_types::BuiltInModule` has no `.tag()`/`.data_slice()`;
            // shim locally with a match (upstream type — cannot add inherent methods).
            let (tag, data): (u8, &[u8]) = match v {
                bun_bundler::bake_types::BuiltInModule::Import(d) => (0, &d[..]),
                bun_bundler::bake_types::BuiltInModule::Code(d) => (1, &d[..]),
            };
            bun_core::write_any_to_hasher(&mut h, &tag);
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
        debug_assert!(
            dev.client_graph.insert_stale(&rfr.import_source, false)?
                == incremental_graph::FileIndex::<{ bake::Side::Client }>(0) // Zig: react_refresh_index = .init(0)
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
            let mut buf = paths::path_buffer_pool::get();
            let joined_root =
                paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
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

            let server_file = dev
                .server_graph
                .insert_stale_extra(&fsr.entry_server, false, true)?;

            types.push(framework_router::Type {
                // SAFETY: `read_dir_info_ignore_error` returns a live `*const DirInfo`.
                abs_root: strings::without_trailing_slash(unsafe { &(*entry).abs_path }).into(),
                prefix: fsr.prefix.clone().into(),
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
                style: fsr.style,
                allow_layouts: fsr.allow_layouts,
                server_file: to_opaque_file_id::<{ bake::Side::Server }>(server_file),
                client_file: if let Some(client) = &fsr.entry_client {
                    to_opaque_file_id::<{ bake::Side::Client }>(
                        dev.client_graph.insert_stale(client, false)?,
                    )
                    .to_optional()
                } else {
                    None
                },
                server_file_string: jsc::StrongOptional::empty(),
            });

            dev.route_lookup.put(
                server_file,
                RouteIndexAndRecurseFlag::new(
                    framework_router::RouteIndex::init(u32::try_from(i).unwrap()),
                    true,
                ),
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

impl Drop for DevServer<'_> {
    fn drop(&mut self) {
        debug_log!("deinit");
        DEV_SERVER_DEINIT_COUNT_FOR_TESTING
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
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

        if self.memory_visualizer_timer.state == EventLoopTimerState::ACTIVE {
            // TODO(port): blocked_on: bun_jsc::VirtualMachine::timer (field is `()` stub)
            let _ = &mut self.memory_visualizer_timer;
        }
        self.graph_safety_lock.lock();
        // bun_watcher is Box<Watcher> — Drop handles, but Zig passed `true` for stop-thread.
        // TODO(port): Watcher::deinit(true) semantics — ensure Drop stops thread.

        #[cfg(feature = "bake_debugging_features")]
        if let Some(dir) = self.dump_dir.take() {
            drop(dir);
        }

        if self.has_pre_crash_handler {
            bun_crash_handler::remove_pre_crash_handler(self as *mut _ as *mut c_void);
        }

        for failure in self.bundling_failures.keys() {
            // TODO(port): blocked_on: SerializedFailure::deinit — Drop on the
            // owning map handles the allocation; explicit deinit was Zig-side.
            let _ = failure;
        }

        if self.current_bundle.is_some() {
            debug_assert!(false); // impossible to de-initialize this state correctly.
        }

        {
            let mut r = self.next_bundle.requests.first;
            while !r.is_null() {
                // SAFETY: intrusive list node; `data` was written by `defer_request`.
                let request = unsafe { &mut *r };
                let data = unsafe { request.data.assume_init_mut() };
                debug_assert!(!matches!(data.handler, Handler::ServerHandler(_)));
                let next = request.next;
                data.deref_();
                r = next;
            }
            self.next_bundle.promise.deinit_idempotently();
        }

        for value in self.source_maps.entries.values_mut() {
            debug_assert!(value.ref_count > 0);
            value.ref_count = 0;
            // TODO(port): blocked_on: source_map_store::Entry::deinit — Drop handles
            // owned buffers; explicit deinit was Zig-side allocator free.
        }
        if self.source_maps.weak_ref_sweep_timer.state == EventLoopTimerState::ACTIVE {
            // TODO(port): blocked_on: bun_jsc::VirtualMachine::timer (field is `()` stub)
            let _ = &mut self.source_maps.weak_ref_sweep_timer;
        }

        for event in &mut self.watcher_atomics.events {
            // TODO(port): blocked_on: bun_collections::StringArrayHashMap::clear
            event.dirs = Default::default();
            event.files = Default::default();
            event.extra_files.clear();
        }

        if let TestingBatchEvents::Enabled(batch) = &mut self.testing_batch_events {
            drop(std::mem::replace(&mut batch.entry_points, EntryPointList::empty()));
        }

        debug_assert!(self.magic == Magic::Valid);
        // self.magic = undefined — no Rust equivalent; freed memory.

        // allocation_scope dropped last automatically by field order.
        // TODO(port): if AllocationScope::ENABLED, deinit happens via Drop.
    }
}

// TODO(port): AllocationScope = bun.allocators.AllocationScopeIn(bun.DefaultAllocator)
pub type AllocationScope = bun_alloc::AllocationScope;
// TODO(port): `AllocationScopeBorrowed` not yet in bun_alloc; alias to the
// scope itself until the borrow-handle type lands.
pub type DevAllocator = bun_alloc::AllocationScope;

impl DevServer<'_> {
    pub fn allocator(&self) -> &dyn bun_alloc::Allocator {
        todo!("blocked_on: bun_alloc::AllocationScope::allocator()")
    }

    pub fn dev_allocator(&self) -> DevAllocator {
        todo!("blocked_on: bun_alloc::AllocationScope::borrow()")
    }
}

// re-exports from memory_cost module already declared at top

impl DevServer<'_> {
    fn init_server_runtime(&mut self) {
        let runtime = BunString::static_(
            crate::bake::bake_body::get_hmr_runtime(crate::bake::bake_body::Side::Server).code,
        );

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
        // TODO(port): blocked_on: framework_router::FrameworkRouter::scan_all —
        // the keystone `FrameworkRouter` in mod.rs has no `scan_all`; the body
        // version (`framework_router_body::FrameworkRouter`) is a distinct type.
        let _ = &mut self.server_transpiler.resolver;
        let _ = &mut self.router;

        self.server_graph.ensure_stale_bit_capacity(true)?;
        self.client_graph.ensure_stale_bit_capacity(true)?;
        Ok(())
    }

    /// Returns true if a catch-all handler was attached.
    // TODO(port): `server: anytype` -- monomorphized over NewServer<SSL,DEBUG> so
    // the SSL flag is a real const-generic (associated consts can't appear in
    // const-generic position on stable).
    pub fn set_routes<const SSL: bool, const DEBUG: bool>(
        &mut self,
        server: &mut crate::server::NewServer<SSL, DEBUG>,
    ) -> Result<bool, bun_core::Error> {
        // TODO: all paths here must be prefixed with publicPath if set.
        self.server = Some(AnyServer::from(server));
        // SAFETY: app is set before set_routes is called (server init path)
        let _app = unsafe { &mut *server.app.unwrap() };
        // TODO(port): blocked_on: bun_uws_sys::App::{get,post,any,ws} —
        // upstream signature is `(pattern: &[u8], handler: extern "C" fn, *mut c_void)`;
        // `wrap_generic_request_handler` returning `impl Fn` cannot coerce to a
        // C fn pointer for a const-generic `SSL`. Needs an extern "C" trampoline
        // table per (handler, SSL) pair (see DevServer.zig:810-840).
        // Silence unused warnings on the handlers we'd register here.
        let _ = (
            on_js_request as fn(_, _, _),
            on_asset_request as fn(_, _, _),
            on_src_request as fn(_, _, _),
            on_not_found as fn(_, _, _),
            on_incremental_visualizer as fn(_, _, _),
            on_memory_visualizer as fn(_, _, _),
        );
        todo!("blocked_on: bun_uws_sys::App route-handler closure adapter + WebSocketBehavior::wrap")
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
    if hex.len() != ::core::mem::size_of::<u64>() * 2 {
        return not_found(resp);
    }
    let Some(id) = parse_hex_to_int::<u64>(hex) else {
        return not_found(resp);
    };

    if is_map {
        // SAFETY: SourceId is #[repr(transparent)] over u64 (same size as id)
        let source_id: source_map_store::SourceId = unsafe { ::core::mem::transmute(id) };
        if dev.source_maps.entries.get_mut(&source_map_store::Key::init(id)).is_none() {
            return not_found(resp);
        }
        let _ = (source_id, req, resp);
        // TODO(port): blocked_on: source_map_store::Entry::render_json +
        // StaticRoute::init_from_any_blob InitFromBytesOptions shape mismatch.
        todo!("blocked_on: source_map_store::Entry::render_json")
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
    let mut out = [0u8; ::core::mem::size_of::<u64>()];
    let Ok(decoded) = strings::decode_hex_to_bytes(&mut out, hex) else {
        return not_found(resp);
    };
    debug_assert!(decoded == ::core::mem::size_of::<u64>());
    let hash: u64 = u64::from_ne_bytes(out);
    debug_log!("onAssetRequest {} {}", hash, bstr::BStr::new(param));
    let Some(asset) = dev.assets.get(hash) else {
        return not_found(resp);
    };
    req.set_yield(false);
    // SAFETY: asset is a live `*mut StaticRoute` held by the content-addressable store
    unsafe { StaticRoute::on(asset, resp) };
}

// TODO(port): Zig was generic over `T` via `@bitCast([@sizeOf(T)]u8)`. Stable
// Rust can't size a stack array by a generic `T` without `generic_const_exprs`,
// so cap the buffer at 16 bytes (enough for u128) and bound on `Copy`.
pub fn parse_hex_to_int<T: Copy>(slice: &[u8]) -> Option<T> {
    let size = ::core::mem::size_of::<T>();
    debug_assert!(size <= 16);
    let mut out = [0u8; 16];
    let decoded = strings::decode_hex_to_bytes(&mut out[..size], slice).ok()?;
    debug_assert!(decoded == size);
    // SAFETY: out[..size] is fully initialized by decode_hex_to_bytes; T: Copy
    Some(unsafe { ::core::ptr::read_unaligned(out.as_ptr() as *const T) })
}

// Free-fn adapter for the route!() macro (the `impl DevServer` method takes a
// generic `R: ResponseLike`, which doesn't fit the `Fn(&mut DevServer, &mut
// Request, AnyResponse)` shape `wrap_generic_request_handler` expects).
fn on_src_request(_dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    if req.header(b"open-in-editor").is_none() {
        resp.write_status(b"501 Not Implemented");
        resp.end(
            b"Viewing source without opening in editor is not implemented yet!",
            false,
        );
        return;
    }
    resp.write_status(b"501 Not Implemented");
    resp.end(b"TODO", false);
}

// TODO(port): `wrapGenericRequestHandler` returned a comptime-generated fn that
// adapts a handler taking `AnyResponse` to one taking `*uws.NewApp(is_ssl).Response`.
// This is a Zig comptime type-generator. In Rust, this becomes a generic adapter fn.
#[inline]
fn wrap_generic_request_handler<H, const IS_SSL: bool>(
    handler: H,
) -> impl Fn(&mut DevServer, &mut Request, *mut bun_uws_sys::NewAppResponse<IS_SSL>)
where
    H: Fn(&mut DevServer, &mut Request, AnyResponse),
{
    // TODO(port): Zig inspected fn_info.params[2].type to decide AnyResponse vs raw.
    move |dev, req, resp| {
        debug_assert!(dev.magic == Magic::Valid);
        // PORT NOTE: `AnyResponse: From<*mut Response<IS_SSL>>` only impl'd for
        // concrete `true`/`false`; branch at runtime on the const generic.
        let any = if IS_SSL {
            AnyResponse::init(resp as *mut bun_uws_sys::response::Response<true>)
        } else {
            AnyResponse::init(resp as *mut bun_uws_sys::response::Response<false>)
        };
        handler(dev, req, any);
    }
}

#[inline]
fn redirect_handler<const IS_SSL: bool>(
    path: &'static [u8],
) -> impl Fn(&mut DevServer, &mut Request, *mut bun_uws_sys::NewAppResponse<IS_SSL>) {
    move |_dev, _req, resp| {
        // SAFETY: resp is valid for the duration of the callback
        let resp = unsafe { &mut *resp };
        resp.write_status(b"302 Found");
        resp.write_header(b"Location", path);
        resp.end(b"Redirecting...", false);
    }
}

fn on_incremental_visualizer(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    resp.corked(move || on_incremental_visualizer_corked(resp));
}

fn on_incremental_visualizer_corked(resp: AnyResponse) {
    let code = if Environment::CODEGEN_EMBED {
        include_bytes!("incremental_visualizer.html").as_slice()
    } else {
        bun_core::runtime_embed_file(bun_core::EmbedKind::SrcEager, "bake/incremental_visualizer.html").as_bytes()
    };
    resp.end(code, false);
}

fn on_memory_visualizer(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    resp.corked(move || on_memory_visualizer_corked(resp));
}

fn on_memory_visualizer_corked(resp: AnyResponse) {
    let code = if Environment::CODEGEN_EMBED {
        include_bytes!("memory_visualizer.html").as_slice()
    } else {
        bun_core::runtime_embed_file(bun_core::EmbedKind::SrcEager, "bake/memory_visualizer.html").as_bytes()
    };
    resp.end(code, false);
}

struct RequestEnsureRouteBundledCtx<'a> {
    dev: &'a mut DevServer<'a>,
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
        let req = ::core::mem::replace(&mut self.req, ReqOrSaved::Aborted); // TODO(port): ReqOrSaved moved into deferRequest
        let resp = self.resp;
        let requests_array: *mut deferred_request::List<'_> = match bundle_field {
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
                    ReqOrSaved::Req(r) => SavedRequestUnion::Stack(unsafe { &mut **r }),
                    // TODO(port): SavedRequest is not Clone; move semantics needed here.
                    ReqOrSaved::Saved(_s) => todo!("blocked_on: SavedRequestUnion::Saved (SavedRequest not Clone)"),
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
        let failures = ::core::slice::from_ref(failure);
        self.dev
            .send_serialized_failures(DevResponse::Http(self.resp), failures, ErrorPageKind::Evaluation, None)?;
        Ok(())
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        self.resp.end(b"Plugin Error", false);
        Ok(())
    }

    fn to_dev_response(&mut self) -> DevResponse {
        DevResponse::Http(self.resp)
    }
}

impl<'a> EnsureRouteCtx for RequestEnsureRouteBundledCtx<'a> {
    fn on_defer(&mut self, b: BundleQueueType) -> JsResult<()> { Self::on_defer(self, b) }
    fn on_loaded(&mut self) -> JsResult<()> { Self::on_loaded(self) }
    fn on_failure(&mut self) -> JsResult<()> { Self::on_failure(self) }
    fn on_plugin_error(&mut self) -> JsResult<()> { Self::on_plugin_error(self) }
    fn to_dev_response(&mut self) -> DevResponse { Self::to_dev_response(self) }
    fn dev(&mut self) -> &mut DevServer { self.dev }
    fn route_bundle_index(&self) -> route_bundle::Index { self.route_bundle_index }
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
                                    .get_or_load_plugins(
                                        crate::server::ServePluginsCallback::DevServer(
                                            // SAFETY: dev_server_body::DevServer<'_> and dev_server::DevServer
                                            // are duplicate Phase-A/keystone shapes pending unification; the
                                            // callee only stores the pointer for plugin-resolution callback.
                                            // TODO(port): blocked_on: dev_server_body::DevServer unification
                                            unsafe { &*(dev as *mut _ as *const crate::bake::dev_server::DevServer) },
                                        ),
                                    )
                                {
                                    crate::server::GetOrStartLoadResult::Pending => {
                                        dev.plugin_state = PluginState::Pending;
                                        plugin = PluginState::Pending;
                                        continue 'plugin;
                                    }
                                    crate::server::GetOrStartLoadResult::Err => {
                                        dev.plugin_state = PluginState::Err;
                                        plugin = PluginState::Err;
                                        continue 'plugin;
                                    }
                                    crate::server::GetOrStartLoadResult::Ready(ready) => {
                                        dev.plugin_state = PluginState::Loaded;
                                        dev.bundler_options.plugin = ready.map(|p| {
                                            ::core::ptr::NonNull::new(p as *const _ as *mut c_void).unwrap()
                                        });
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
            ReqOrSaved::Saved(saved) => unsafe { (*saved.request).method },
            ReqOrSaved::Aborted => unreachable!(),
        }
    }
}

impl DevServer<'_> {
    fn defer_request(
        &mut self,
        requests_array: &mut deferred_request::List<'_>,
        route_bundle_index: route_bundle::Index,
        kind: deferred_request::HandlerKind,
        req: ReqOrSaved,
        resp: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        let Some(deferred_ptr) = self.deferred_request_pool.get() else { return Ok(()) };
        // SAFETY: HiveArray::get returns an exclusively-owned, live node ptr.
        let deferred = unsafe { &mut *deferred_ptr };
        debug_log!("DeferredRequest(0x{:x}).init", &deferred.data as *const _ as usize);

        let method = match &req {
            // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
            ReqOrSaved::Req(r) => Method::which(unsafe { &**r }.method()).unwrap_or(Method::GET),
            ReqOrSaved::Saved(saved) => unsafe { (*saved.request).method },
            _ => unreachable!(),
        };

        deferred.data.write(DeferredRequest {
            route_bundle_index,
            dev: self as *const _,
            referenced_by_devserver: true,
            weakly_referenced_by_requestcontext: false,
            handler: match kind {
                deferred_request::HandlerKind::BundledHtmlPage => 'brk: {
                    // PORT NOTE: `on_aborted<U: 'static>` rejects `DeferredRequest<'_>`;
                    // erase to `c_void` and cast back inside the trampoline.
                    resp.on_aborted(
                        |p: *mut c_void, r: AnyResponse| {
                            // SAFETY: p is the &mut deferred.data registered below; lifetime erased
                            unsafe { &mut *(p as *mut DeferredRequest<'static>) }.on_abort(r)
                        },
                        &mut deferred.data as *mut _ as *mut c_void,
                    );
                    break 'brk Handler::BundledHtmlPage(ResponseAndMethod { response: resp, method });
                }
                deferred_request::HandlerKind::ServerHandler => 'brk: {
                    let server_handler: SavedRequest = match req {
                        ReqOrSaved::Req(_r) => {
                            // TODO(port): blocked_on: server::AnyServer::prepare_and_save_js_request_context
                            // returns server_body::SavedRequest<'_> (distinct from crate::server::SavedRequest);
                            // unify the two SavedRequest shapes before wiring this path.
                            let _ = (resp, method, deferred_ptr);
                            todo!("blocked_on: server::SavedRequest unification (server_body vs server::mod)")
                        }
                        ReqOrSaved::Saved(saved) => saved,
                        _ => unreachable!(),
                    };
                    server_handler.ctx.ref_();
                    server_handler.ctx.set_additional_on_abort_callback(Some(
                        crate::server::any_request_context::AdditionalOnAbortCallback {
                            cb: {
                                fn cb(ptr: *mut c_void) {
                                    DeferredRequest::on_abort_wrapper(ptr)
                                }
                                cb
                            },
                            // SAFETY: deferred.data is a live field of a HiveArray-owned node
                            data: unsafe {
                                ::core::ptr::NonNull::new_unchecked(
                                    &mut deferred.data as *mut _ as *mut c_void,
                                )
                            },
                            deref_fn: {
                                fn deref_fn(ptr: *mut c_void) {
                                    // SAFETY: ptr is &mut DeferredRequest from above
                                    let self_: &mut DeferredRequest =
                                        unsafe { &mut *(ptr as *mut DeferredRequest) };
                                    self_.weak_deref();
                                }
                                deref_fn
                            },
                        },
                    ));
                    break 'brk Handler::ServerHandler(server_handler);
                }
            },
        };

        if matches!(deferred.data.handler, Handler::ServerHandler(_)) {
            deferred.data.weak_ref();
        }

        requests_array.prepend(deferred_ptr);
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

impl DevServer<'_> {
    fn append_route_entry_points_if_not_stale(
        &mut self,
        entry_points: &mut EntryPointList,
        rbi: route_bundle::Index,
    ) -> Result<(), bun_core::Error> {
        let server_file_names = self.server_graph.bundled_files.keys();
        let client_file_names = self.client_graph.bundled_files.keys();

        // Build a list of all files that have not yet been bundled.
        match &self.route_bundle_ptr(rbi).data {
            route_bundle::Data::Framework(bundle) => {
                let mut route = self.router.route_ptr(bundle.route_index);
                let route_type_idx = route.r#type;
                let router_type = self.router.type_ptr(route_type_idx);
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
                // SAFETY: html_bundle is a live *mut HTMLBundleRoute (held strong by route_bundle::Html)
                let bundle_path = unsafe { &(*html.html_bundle).bundle.path };
                entry_points.append(bundle_path, entry_point_list::Flags::CLIENT)?;
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

impl DevServer<'_> {
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
        let route_type_idx = self.router.route_ptr(framework_bundle.route_index).r#type;
        let router_type = self.router.type_ptr(route_type_idx);

        Ok(FrameworkRequestArgs {
            // routerTypeMain
            router_type_main: match router_type.server_file_string.get() {
                Some(s) => s,
                None => 'str: {
                    let name = &self.server_graph.bundled_files.keys()
                        [from_opaque_file_id::<{ bake::Side::Server }>(router_type.server_file).get() as usize];
                    let mut buf = paths::path_buffer_pool::get();
                    let s = bun_jsc::bun_string_jsc::create_utf8_for_js(global, self.relative_path(&mut *buf, name))?;
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
                        if route.file_layout.is_some() {
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = self.router.route_ptr(p);
                    }
                    let arr = JSValue::create_empty_array(global, n)?;
                    route = self.router.route_ptr(framework_bundle.route_index);
                    {
                        let buf = paths::path_buffer_pool::get();
                        let mut route_name = BunString::clone_utf8(self.relative_path(
                            &mut *buf,
                            &keys[from_opaque_file_id::<{ bake::Side::Server }>(
                                route.file_page.unwrap(),
                            )
                            .get() as usize],
                        ));
                        arr.put_index(global, 0, route_name.transfer_to_js(global)?)?;
                    }
                    n = 1;
                    loop {
                        if let Some(layout) = route.file_layout {
                            let buf = paths::path_buffer_pool::get();
                            let mut layout_name = BunString::clone_utf8(self.relative_path(
                                &mut *buf,
                                &keys[from_opaque_file_id::<{ bake::Side::Server }>(layout).get() as usize],
                            ));
                            arr.put_index(global, u32::try_from(n).unwrap(), layout_name.transfer_to_js(global)?)?;
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
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
                    ));
                    let _deref = scopeguard::guard((), |_| s.deref());
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
        req: SavedRequestUnion,
        resp: AnyResponse,
    ) -> JsResult<()> {
        let route_bundle = self.route_bundle_ptr(route_bundle_index);
        debug_assert!(matches!(route_bundle.data, route_bundle::Data::Framework(_)));

        let framework_bundle = match &mut route_bundle.data {
            route_bundle::Data::Framework(f) => f,
            _ => unreachable!(),
        };

        // Extract route params by re-matching the URL
        let mut params: framework_router::MatchedParams = Default::default();
        let url_bunstr = match &req {
            // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
            SavedRequestUnion::Stack(r) => BunString::borrow_utf8((**r).url()),
            SavedRequestUnion::Saved(data) => 'brk: {
                // SAFETY: data.request is a live *mut webcore::Request (held strong by ctx)
                let url = unsafe { &(*data.request).url }.clone();
                url.ref_();
                break 'brk url;
            }
        };
        let _deref = scopeguard::guard((), |_| url_bunstr.deref());
        let url = url_bunstr.to_utf8();

        // Extract pathname from URL (remove protocol, host, query, hash)
        let pathname = extract_pathname_from_url(url.slice());

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

        let _ = (
            req,
            resp,
            server_request_callback,
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
        todo!("blocked_on: AnyServer::on_saved_request (crate::server::SavedRequestUnion is unnameable)");
        #[allow(unreachable_code)]
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
        let html = match &mut route_bundle.data {
            route_bundle::Data::Html(h) => h,
            _ => unreachable!(),
        };

        let blob: *mut StaticRoute = match html.cached_response {
            Some(b) => b.as_ptr(),
            None => 'generate: {
                let payload =
                    self.generate_html_payload(route_bundle_index, route_bundle, html).expect("oom");

                let route_ptr = StaticRoute::init_from_any_blob(
                    &crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::HTML),
                        server: self.server,
                        ..Default::default()
                    },
                );
                html.cached_response = ::core::ptr::NonNull::new(route_ptr);
                break 'generate route_ptr;
            }
        };
        // SAFETY: blob is a live boxed StaticRoute owned by html.cached_response
        unsafe { StaticRoute::on_with_method(blob, method, resp) };
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

impl DevServer<'_> {
    fn generate_html_payload(
        &mut self,
        route_bundle_index: route_bundle::Index,
        route_bundle: &mut RouteBundle,
        html: &mut route_bundle::Html,
    ) -> Result<Vec<u8>, bun_core::Error> {
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
        // SAFETY: html_bundle is a live *mut HTMLBundleRoute (held strong by route_bundle::Html)
        debug_assert!(unsafe { (*html.html_bundle).dev_server_id } == Some(route_bundle_index));
        debug_assert!(html.cached_response.is_none());
        let script_injection_offset = html.script_injection_offset.unwrap().0 as usize;
        let bundled_html = html.bundled_html_text.as_ref().unwrap();

        // The bundler records an offsets in development mode, splitting the HTML
        // file into two chunks. DevServer is able to insert style/script tags
        // using the information available in IncrementalGraph.
        let before_head_end = &bundled_html[..script_injection_offset];
        let after_head_end = &bundled_html[script_injection_offset..];

        let mut display_name = strings::without_suffix_comptime(
            // SAFETY: html_bundle is a live *mut HTMLBundleRoute (held strong by route_bundle::Html)
            paths::basename(unsafe { &(*html.html_bundle).bundle.path }),
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

        // TODO(port): IncrementalGraph::current_css_files (gated per-bundle scratch)
        let css_ids: &[u64] = &[];

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
        let n = bun_core::fmt::bytes_to_hex_lower(&(route_bundle_index.get() as u32).to_ne_bytes(), &mut hex_buf);
        array.extend_from_slice(&hex_buf[..n]);
        let n = bun_core::fmt::bytes_to_hex_lower(&route_bundle.client_script_generation.to_ne_bytes(), &mut hex_buf);
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
        index: bun_js_parser::ast::Index,
        import_records: &[bun_collections::BabyList<ImportRecord>],
        input_file_sources: &[bun_logger::Source],
        loaders: &[Loader],
    ) -> Result<Box<[u8]>, bun_core::Error> {
        // PERF(port): was stack-fallback (65536)
        let mut array: Vec<u8> = Vec::with_capacity(65536);
        let w = &mut array;

        w.extend_from_slice(b"  ");
        bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
            &input_file_sources[index.get() as usize].path.pretty,
            w,
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
                if !matches!(file.content, incremental_graph::Content::Js(_)) {
                    continue;
                }
            }
            if !any {
                any = true;
                w.extend_from_slice(b"\n");
            }
            w.extend_from_slice(b"    ");
            bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(&import.path.pretty, w)?;
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
        let client_bundle: *mut StaticRoute = match route_bundle.client_bundle {
            Some(cb) => cb.as_ptr(),
            None => 'generate: {
                let payload = self.generate_client_bundle(route_bundle).expect("oom");
                let route_ptr = StaticRoute::init_from_any_blob(
                    &crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::JAVASCRIPT),
                        server: self.server,
                        ..Default::default()
                    },
                );
                route_bundle.client_bundle = ::core::ptr::NonNull::new(route_ptr);
                break 'generate route_ptr;
            }
        };
        // TODO(port): SourceMapStore::add_weak_ref — gated; only remove_or_upgrade_weak_ref is un-gated
        let _ = route_bundle.source_map_id();
        // SAFETY: client_bundle is a live boxed StaticRoute owned by route_bundle.client_bundle
        unsafe { StaticRoute::on_with_method(client_bundle, method, resp) };
    }

    // TODO(port): resp: anytype — wrap_generic_request_handler always passes AnyResponse
    pub fn on_src_request(&mut self, req: &mut Request, resp: AnyResponse) {
        if req.header(b"open-in-editor").is_none() {
            resp.write_status(b"501 Not Implemented");
            resp.end(
                b"Viewing source without opening in editor is not implemented yet!",
                false,
            );
            return;
        }

        // TODO: better editor detection. on chloe's dev env, this opens apple terminal + vim
        // This is already done in Next.js. we have to port this to Zig so we can use.
        resp.write_status(b"501 Not Implemented");
        resp.end(b"TODO", false);
        let _ = self;
    }
}

pub enum DevResponse<'a> {
    Http(AnyResponse),
    Promise(PromiseResponse<'a>),
}

/// When requests are waiting on a bundle, the relevant request information is
/// prepared and stored in a linked list.
pub struct DeferredRequest<'a> {
    pub route_bundle_index: route_bundle::Index,
    pub handler: Handler,
    pub dev: *const DevServer<'a>, // BACKREF: owned by dev.deferred_request_pool

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

    pub type List<'a> = bun_collections::pool::SinglyLinkedList<DeferredRequest<'a>>;
    pub type Node<'a> = bun_collections::pool::Node<DeferredRequest<'a>>;

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
use deferred_request::{DlogeferredRequest, Handler, PromiseResponse};

/// `SavedRequest.Union` — local mirror of `crate::server::server_body::SavedRequestUnion`
/// (the upstream enum is in a private module and is unnameable here).
// TODO(port): replace with a `pub use` once `server::server_body` is public.
pub enum SavedRequestUnion<'a> {
    Stack(&'a mut uws::Request),
    Saved(SavedRequest),
}

impl DeferredRequest<'_> {
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

    fn on_abort_wrapper(this: *mut c_void) {
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
            Handler::ServerHandler(saved) => {
                // TODO(port): blocked_on: bun_jsc::Strong::deinit — `Strong` is
                // non-nullable; explicit teardown happens via `Drop` when the
                // owning `SavedRequest` is dropped. The pool stores
                // `MaybeUninit<DeferredRequest>` so this must drop in place
                // once `Handler` ownership is reshaped.
                let _ = &mut saved.js_request;
            }
            Handler::BundledHtmlPage(_) | Handler::Aborted => {}
        }
        // PORT NOTE: SavedRequest::deinit added in src/runtime/server/mod.rs
    }

    /// Deinitializes state by aborting the connection.
    fn abort(&mut self) {
        deferred_request::debug_log_dr!("DeferredRequest(0x{:x}) abort", self as *const _ as usize);
        let handler = ::core::mem::replace(&mut self.handler, Handler::Aborted);
        match handler {
            Handler::ServerHandler(saved) => {
                deferred_request::debug_log_dr!(
                    "  request url: {}",
                    // SAFETY: saved.request is a live *mut webcore::Request (held strong by ctx)
                    bstr::BStr::new(unsafe { &(*saved.request).url }.byte_slice())
                );
                saved.ctx.set_signal_aborted(jsc::CommonAbortReason::ConnectionClosed);
                // PORT NOTE: saved.js_request (jsc::Strong) drops at end of arm
                drop(saved);
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

impl DevServer<'_> {
    pub fn start_async_bundle(
        &mut self,
        entry_points: EntryPointList,
        had_reload_event: bool,
        timer: Instant,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(self.current_bundle.is_none());
        debug_assert!(!entry_points.set.is_empty());
        self.log.clear_and_free();

        // Notify inspector about bundle start
        // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
        if let Some(agent) = unsafe { self.inspector() } {
            // PERF(port): was stack-fallback
            let mut trigger_files: Vec<BunString> = Vec::with_capacity(entry_points.set.len());
            for key in entry_points.set.keys() {
                trigger_files.push(BunString::clone_utf8(key));
            }
            let _ = (agent, &trigger_files);
            todo!("blocked_on: bun_jsc::debugger::BunFrontendDevServerAgent::notify_bundle_start");
            #[allow(unreachable_code)]
            for s in &mut trigger_files {
                s.deref();
            }
        }

        self.incremental_result.reset();

        let mut heap = bun_alloc::MimallocArena::new();
        // TODO(port): heap is moved into BundleV2; errdefer heap.deinit() handled by Drop
        let alloc = heap.allocator();
        // TODO(port): ASTMemoryAllocator scope — bake is an AST crate; arena threading required
        let ast_memory_allocator = alloc.alloc(bun_js_parser::ASTMemoryAllocator::default());
        let _ast_scope = ast_memory_allocator.enter();
        let _ = alloc; // PORT NOTE: `enter()` no longer takes the arena (T1 stub).

        let bv2 = BundleV2::init(
            &mut self.server_transpiler,
            Some(bundler::bundle_v2::BakeOptions {
                framework: todo!("blocked_on: bake::Framework Clone"),
                client_transpiler: ::core::ptr::NonNull::from(&mut self.client_transpiler),
                ssr_transpiler: ::core::ptr::NonNull::from(&mut self.ssr_transpiler),
                plugins: self.bundler_options.plugin.map(|p| p.cast()),
            }),
            alloc,
            // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
            // PORT NOTE: bundler::EventLoop is an erased `Option<NonNull<()>>` (was AnyEventLoop union).
            ::core::ptr::NonNull::new(unsafe { &*self.vm }.event_loop().cast::<()>()),
            false, // watching is handled separately
            // SAFETY: WorkPool is a 'static singleton; BundleV2::init wants Option<&mut ThreadPool>
            Some(unsafe { &mut *(bun_threading::work_pool::WorkPool::get() as *const _ as *mut _) }),
            heap,
        )?;
        bv2.bun_watcher = Some(::core::ptr::NonNull::from(&mut *self.bun_watcher).cast::<()>());
        bv2.asynchronous = true;

        {
            self.graph_safety_lock.lock();
            let _g = scopeguard::guard((), |_| self.graph_safety_lock.unlock());
            self.client_graph.reset();
            self.server_graph.reset();
        }

        let start_data = bv2.start_from_bake_dev_server(entry_points)?;
        self.current_bundle = Some(CurrentBundle {
            bv2,
            timer,
            start_data,
            had_reload_event,
            requests: ::core::mem::take(&mut self.next_bundle.requests),
            promise: ::core::mem::take(&mut self.next_bundle.promise),
            resolution_failure_entries: Default::default(),
        });

        self.next_bundle.promise = DeferredPromise::default();
        self.next_bundle.requests = deferred_request::List::default();
        self.next_bundle.route_queue.clear_retaining_capacity();
        Ok(())
    }

    pub fn prepare_and_log_resolution_failures(&mut self) -> Result<(), bun_core::Error> {
        // Since resolution failures can be asynchronous, their logs are not inserted
        // until the very end.
        let resolution_failures = &self.current_bundle.as_ref().unwrap().resolution_failure_entries;
        if !resolution_failures.is_empty() {
            for (owner, log) in resolution_failures.keys().iter().zip(resolution_failures.values()) {
                if log.has_errors() {
                    // `resolution_failure_entries` keys are `OwnerPacked` (1-bit side + file).
                    let index = owner.file();
                    match owner.side() {
                        bake::Side::Client => {
                            let _ = (&self.client_graph, index, log);
                            todo!("blocked_on: IncrementalGraph::insert_failure")
                        }
                        bake::Side::Server => {
                            let _ = (&self.server_graph, index, log);
                            todo!("blocked_on: IncrementalGraph::insert_failure")
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
            let _ = self.log.print(Output::error_writer() as *mut _);
        }
        Ok(())
    }

    fn index_failures(&mut self) -> Result<(), bun_core::Error> {
        // After inserting failures into the IncrementalGraphs, they are traced to their routes.
        // PERF(port): was stack-fallback (65536)

        if !self.incremental_result.failures_added.is_empty() {
            let mut total_len: usize =
                ::core::mem::size_of::<MessageId>() + ::core::mem::size_of::<u32>();

            for fail in &self.incremental_result.failures_added {
                total_len += fail.data.len();
            }

            total_len += self.incremental_result.failures_removed.len() * ::core::mem::size_of::<u32>();

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
                    &unsafe { ::core::mem::transmute::<_, u32>(removed.get_owner().encode()) }.to_le_bytes(),
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
                        .trace_dependencies(index, &mut gts, incremental_graph::TraceDependencyGoal::NoStop, index)?,
                    serialized_failure::Owner::Client(index) => self
                        .client_graph
                        .trace_dependencies(index, &mut gts, incremental_graph::TraceDependencyGoal::NoStop, index)?,
                }
            }

            for entry in &self.incremental_result.framework_routes_affected {
                if let Some(index) = self.router.route_ptr(entry.route_index()).bundle {
                    self.route_bundle_ptr(index).server_state =
                        route_bundle::State::PossibleBundlingFailures;
                }
                if entry.should_recurse_when_visiting() {
                    self.mark_all_route_children_failed(entry.route_index());
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

            self.publish(HmrTopic::Errors, &payload, Opcode::BINARY);
        } else if !self.incremental_result.failures_removed.is_empty() {
            let mut payload: Vec<u8> = Vec::with_capacity(
                ::core::mem::size_of::<MessageId>()
                    + ::core::mem::size_of::<u32>()
                    + self.incremental_result.failures_removed.len() * ::core::mem::size_of::<u32>(),
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
                    &unsafe { ::core::mem::transmute::<_, u32>(removed.get_owner().encode()) }.to_le_bytes(),
                );
                removed.deinit(self);
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::BINARY);
        }

        self.incremental_result.failures_removed.clear();
        Ok(())
    }

    /// Used to generate the entry point. Unlike incremental patches, this always
    /// contains all needed files for a route.
    fn generate_client_bundle(&mut self, route_bundle: &mut RouteBundle) -> Result<Vec<u8>, bun_core::Error> {
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
            route_bundle::Data::Framework(fw) => {
                let type_idx = self.router.route_ptr(fw.route_index).r#type;
                self.router
                    .type_ptr(type_idx)
                    .client_file
                    .map(|ofi| from_opaque_file_id::<{ bake::Side::Client }>(ofi))
            }
            route_bundle::Data::Html(html) => Some(html.bundled_file),
        };

        // Insert the source map
        let script_id = route_bundle.source_map_id();
        map_log!("inc {:x}, 1 for generateClientBundle", script_id.get());
        match self.source_maps.put_or_increment_ref_count(script_id, 1)? {
            source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => {
                let _guard = scopeguard::guard((), |_| self.source_maps.unref(script_id));
                // TODO(port): errdefer — disarm on success
                gts.clear_and_free();
                // PERF(port): was ArenaAllocator
                // TODO(port): `take_source_map` is typed against the keystone
                // `source_map_store::Entry`; the body-module `Entry` will unify
                // once `source_map_store_body` is folded in.
                let _ = entry;
                let _: () = todo!("blocked_on: source_map_store::Entry unification with source_map_store_body::Entry");
                #[allow(unreachable_code)]
                scopeguard::ScopeGuard::into_inner(_guard);
            }
            source_map_store::PutOrIncrementRefCount::Shared(_) => {}
        }

        let _ = (client_file, react_fast_refresh_id, script_id);
        // TODO(port): `TakeJSBundleOptionsClient` borrow fields are `'static`; the
        // local-slice form here cannot be expressed until that struct gets a lifetime.
        let client_bundle: Vec<u8> = todo!("blocked_on: IncrementalGraph::take_js_bundle (client)");
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

        let names: &[u64] = &self.client_graph.current_css_files;
        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*self.vm).global };
        let arr = jsc::JSArray::create_empty(global, names.len())?;
        for (i, item) in names.iter().enumerate() {
            let mut buf = [0u8; ASSET_PREFIX.len() + ::core::mem::size_of::<u64>() * 2 + "/.css".len()];
            let path = {
                let mut cursor = &mut buf[..];
                write!(
                    cursor,
                    "{}/{}.css",
                    ASSET_PREFIX,
                    bstr::BStr::new(bun_core::fmt::bytes_to_hex_lower_string(&item.to_ne_bytes()).as_bytes()),
                )
                .expect("unreachable");
                let written = buf.len() - cursor.len();
                &buf[..written]
            };
            let s = BunString::clone_utf8(path);
            let _deref = scopeguard::guard((), |_| s.deref());
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
                let router_type = self.router.type_ptr(route.r#type);

                // Both framework entry points are considered
                self.server_graph.trace_imports(
                    from_opaque_file_id::<{ bake::Side::Server }>(router_type.server_file),
                    gts,
                    TraceImportGoal::FindCss,
                )?;
                if let Some(id) = router_type.client_file {
                    self.client_graph.trace_imports(
                        from_opaque_file_id::<{ bake::Side::Client }>(id),
                        gts,
                        goal,
                    )?;
                }

                // The route file is considered
                if let Some(id) = route.file_page {
                    self.server_graph
                        .trace_imports(from_opaque_file_id::<{ bake::Side::Server }>(id), gts, goal)?;
                }

                // For all parents, the layout is considered
                loop {
                    if let Some(id) = route.file_layout {
                        self.server_graph.trace_imports(
                            from_opaque_file_id::<{ bake::Side::Server }>(id),
                            gts,
                            goal,
                        )?;
                    }
                    let Some(p) = route.parent else { break };
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
            let buf = paths::path_buffer_pool::get();
            let s = BunString::clone_utf8(self.relative_path(&mut *buf, &names[item.get() as usize]));
            let _deref = scopeguard::guard((), |_| s.deref());
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
    pub scbs: bun_js_parser::ast::server_component_boundary::Slice<'a>,
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

/// Sentinel-encoded `Option<FileIndex>` packed into a `u32` (`u32::MAX` == none).
/// Mirrors Zig `IncrementalGraph(side).FileIndex.Optional`. Side-erased so the
/// `resolved_index_cache: &mut [u32]` backing slice can be reinterpreted in
/// place; callers re-tag with the correct `FileIndex<SIDE>` on `unwrap`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct CachedFileIndex(pub u32);
impl CachedFileIndex {
    pub const NONE: Self = Self(u32::MAX);
    #[inline] pub const fn raw(self) -> u32 { self.0 }
    #[inline] pub fn unwrap<const SIDE: bake::Side>(self) -> Option<incremental_graph::FileIndex<SIDE>> {
        if self.0 == u32::MAX { None } else { Some(incremental_graph::FileIndex::<SIDE>::init(self.0)) }
    }
}
impl<const SIDE: bake::Side> From<Option<incremental_graph::FileIndex<SIDE>>> for CachedFileIndex {
    fn from(v: Option<incremental_graph::FileIndex<SIDE>>) -> Self {
        match v { Some(i) => Self(i.get()), None => Self::NONE }
    }
}
// Body-module `FileIndex` (non-const-generic) — same wire shape as the header
// `FileIndex<SIDE>`; provided so `incremental_graph_body` call sites can `.into()`.
impl From<Option<crate::bake::dev_server::incremental_graph::BodyFileIndex>> for CachedFileIndex {
    fn from(v: Option<crate::bake::dev_server::incremental_graph::BodyFileIndex>) -> Self {
        match v { Some(i) => Self(i.get()), None => Self::NONE }
    }
}

impl<'a> HotUpdateContext<'a> {
    pub fn get_cached_index(
        &mut self,
        side: bake::Side,
        i: impl Into<bun_js_parser::ast::Index>,
    ) -> &mut CachedFileIndex {
        let i: bun_js_parser::ast::Index = i.into();
        let len = self.sources.len();
        let start = match side {
            bake::Side::Client => 0,
            bake::Side::Server => len,
        };

        let subslice = &mut self.resolved_index_cache[start..][..len];

        const _: () = assert!(
            ::core::mem::align_of::<CachedFileIndex>() == ::core::mem::align_of::<u32>()
        );
        const _: () = assert!(
            ::core::mem::size_of::<CachedFileIndex>() == ::core::mem::size_of::<u32>()
        );
        let elem: &mut u32 = &mut subslice[i.get() as usize];
        // SAFETY: CachedFileIndex is repr(transparent) over u32; pointer derived
        // from a unique `&mut u32` so the resulting `&mut` is non-aliased.
        unsafe { &mut *(elem as *mut u32 as *mut CachedFileIndex) }
    }
}


/// Called at the end of BundleV2 to index bundle contents into the `IncrementalGraph`s
/// This function does not recover DevServer state if it fails (allocation failure)
pub fn finalize_bundle(
    dev: &mut DevServer,
    bv2: &mut BundleV2,
    result: &mut bundler::bundle_v2::DevServerOutput,
) -> JsResult<()> {
    debug_assert!(dev.magic == Magic::Valid);
    let mut had_sent_hmr_event = false;

    // TODO(port): the giant `defer` block at the start of finalizeBundle has been
    // moved into a scopeguard. Phase B must verify ordering relative to ?-returns.
    let dev_ptr = dev as *mut DevServer;
    let _outer_defer = scopeguard::guard((), |_| {
        // SAFETY: dev outlives this scope
        let dev = unsafe { &mut *dev_ptr };
        // TODO(port): heap moved out before deinit
        let mut heap = ::core::mem::replace(&mut bv2.graph.heap, bun_alloc::Arena::new());
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
        if !current_bundle.requests.first.is_null() {
            // cannot be an assertion because in the case of OOM, the request list was not drained.
            Output::debug(
                "current_bundle.requests.first != null. this leaves pending requests without an error page!",
            );
        }
        while let Some(node) = current_bundle.requests.pop_first() {
            // SAFETY: pop_first returns a live `*mut Node<T>` from the intrusive list.
            let req = unsafe { &mut (*node).data };
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
        .source_index()
        .iter()
        .zip(scbs.list.ssr_source_index())
        .zip(scbs.list.reference_source_index())
    {
        scb_bitset.set(*source_index as usize);
        scb_bitset.set(*ref_index as usize);
        if (*ssr_index as usize) < scb_bitset.capacity() {
            scb_bitset.set(*ssr_index as usize);
        }
    }

    let mut resolved_index_cache = vec![
        CachedFileIndex::NONE.raw();
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
        let source_map: bun_sourcemap::Chunk = match compile_result.source_map_chunk() {
            Some(c) => c.clone(),
            None => 'brk: {
                // The source map is `null` if empty
                debug_assert!(matches!(compile_result, bundler::CompileResult::Javascript { result: bun_js_printer::PrintResult::Result(_), .. }));
                debug_assert!(dev.server_transpiler.options.source_map != bundler::options::SourceMapOption::None);
                debug_assert!(!part_range.source_index.is_runtime());
                break 'brk bun_sourcemap::Chunk::init_empty();
            }
        };
        let quoted_contents = &quoted_source_contents[part_range.source_index.get() as usize];
        match targets[part_range.source_index.get() as usize].bake_graph() {
            bake::Graph::Client => dev.client_graph.receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ReceiveChunkContent::Js {
                    code: compile_result.code().to_vec().into_boxed_slice(),
                    source_map: Some(incremental_graph::ReceiveChunkSourceMap {
                        chunk: source_map,
                        escaped_source: quoted_contents.clone(),
                    }),
                },
                false,
            )?,
            graph @ (bake::Graph::Server | bake::Graph::Ssr) => dev.server_graph.receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ReceiveChunkContent::Js {
                    code: compile_result.code().to_vec().into_boxed_slice(),
                    source_map: Some(incremental_graph::ReceiveChunkSourceMap {
                        chunk: source_map,
                        escaped_source: quoted_contents.clone(),
                    }),
                },
                graph == bake::Graph::Ssr,
            )?,
        }
    }

    for (chunk, metadata) in result.css_chunks().iter_mut().zip(result.css_file_list.values()) {
        debug_assert!(matches!(chunk.content, bundler::chunk::Content::Css(_)));

        let index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index());

        let code = {
            let _ = (&bv2.graph, &bv2.linker.graph, &result.chunks, chunk as *mut _);
            todo!("blocked_on: bun_bundler::IntermediateOutput::code (split self/chunk borrow)");
            #[allow(unreachable_code)]
            bundler::chunk::CodeResult { buffer: Vec::new().into(), shifts: Default::default() }
        };

        // Create an entry for this file.
        let key = ctx.sources[index.get() as usize].path.key_for_incremental_graph();
        // TODO: use a hash mix with the first half being a path hash and the second half content hash
        let h = hash(key);
        let asset_index = dev.assets.replace_path(
            key,
            &crate::webcore::blob::Any::from_owned_slice(code.buffer.into()),
            &MimeType::CSS,
            h,
        )?;
        // Later code needs to retrieve the CSS content
        // The hack is to use `entry_point_id`, which is otherwise unused, to store an index.
        chunk.entry_point.set_entry_point_id(asset_index.get() as u32);

        // Track css files that look like tailwind files.
        if let Some(map) = &mut dev.has_tailwind_plugin_hack {
            let first_1024 = &code.buffer[..code.buffer.len().min(1024)];
            if strings::index_of(first_1024, b"tailwind").is_some() {
                // PORT NOTE: `get_or_put` consumes the key by value; on miss the key
                // already lives in the map so the explicit `*key_ptr =` is redundant.
                let _ = map.get_or_put(Box::from(key))?;
            } else {
                let _ = map.swap_remove(&Box::<[u8]>::from(key));
            }
        }

        dev.client_graph
            .receive_chunk(&mut ctx, index, incremental_graph::ReceiveChunkContent::Css(h), false)?;

        // If imported on server, there needs to be a server-side file entry
        // so that edges can be attached.
        if metadata.imported_on_server {
            dev.server_graph.insert_css_file_on_server(&mut ctx, index, key)?;
        }
    }

    for chunk in result.html_chunks().iter_mut() {
        let index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index());
        let bundler::CompileResult::Html { code: compile_result_code, script_injection_offset: compile_result_offset, .. } =
            &chunk.compile_results_for_chunk[0]
        else { unreachable!() };
        let generated_js = dev.generate_javascript_code_for_html_file(
            index,
            import_records,
            input_file_sources,
            bv2.graph.input_files.items_loader(),
        )?;
        dev.client_graph.receive_chunk(
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
        let route_bundle_index = dev.client_graph.html_route_bundle_index(client_index);
        let route_bundle = dev.route_bundle_ptr(route_bundle_index);
        debug_assert!(route_bundle.data.html().bundled_file == client_index);
        // PORT NOTE: split borrow — `invalidate_client_bundle` needs `&mut RouteBundle`
        // so the `cached_response` take is done before the long-lived `html` borrow.
        if route_bundle.data.html_mut().cached_response.take().is_some() {
            // Arc<StaticRoute> drop releases the ref.
            route_bundle.invalidate_client_bundle(dev_ptr.cast());
        }
        let html = match &mut route_bundle.data {
            route_bundle::Data::Html(h) => h,
            _ => unreachable!(),
        };
        if let Some(_slice) = html.bundled_html_text.take() {
            // freed by Drop
        }
        #[cfg(feature = "allocation_scope")]
        dev.allocation_scope.assert_owned(compile_result_code);
        html.bundled_html_text = Some(compile_result_code.clone()); // TODO(port): ownership transfer
        html.script_injection_offset =
            Some(route_bundle::ByteOffset(*compile_result_offset));

        chunk.entry_point.set_entry_point_id(u32::try_from(route_bundle_index.get()).unwrap());
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
                incremental_graph::ProcessMode::Normal,
                part_range.source_index,
            )?,
            bake::Graph::Client => dev.client_graph.process_chunk_dependencies(
                &mut ctx,
                incremental_graph::ProcessMode::Normal,
                part_range.source_index,
            )?,
        }
    }
    for chunk in result.html_chunks() {
        let index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index());
        dev.client_graph
            .process_chunk_dependencies(&mut ctx, incremental_graph::ProcessMode::Normal, index)?;
    }
    for chunk in result.css_chunks() {
        let entry_index = bun_js_parser::ast::Index::init(chunk.entry_point.source_index());
        dev.client_graph
            .process_chunk_dependencies(&mut ctx, incremental_graph::ProcessMode::Css, entry_index)?;
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
                let mut source_map_entry = source_map_store::Entry { ref_count: 1, ..Default::default() };

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

        let server_bundle = dev.server_graph.take_js_bundle_server(&incremental_graph::TakeJSBundleOptionsServer {
            kind: ChunkKind::HmrChunk,
            script_id: server_script_id,
        })?;
        // freed by Drop

        // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
        let global = unsafe { &*(*dev.vm).global };
        let server_modules = if let Some(json) = source_map_json {
            // This memory will be owned by the `DevServerSourceProvider` in C++
            #[cfg(feature = "allocation_scope")]
            dev.allocation_scope.leak_slice(&json);
            let json: ::core::mem::ManuallyDrop<Vec<u8>> = ::core::mem::ManuallyDrop::new(json);

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
                {
                    // `bun_jsc::JSGlobalObject::to_js_value` lives in the
                    // not-yet-re-exported `JSGlobalObject.rs` impl block.
                    let _ = global;
                    todo!("blocked_on: bun_jsc::JSGlobalObject::to_js_value")
                },
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
            let route = dev.router.route_ptr(request.route_index());
            if let Some(id) = route.bundle {
                route_bits.set(id.get() as usize);
            }
            if request.should_recurse_when_visiting() {
                mark_all_route_children(&dev.router, &mut [&mut route_bits], request.route_index());
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
                .trace_dependencies(*index, ctx.gts, incremental_graph::TraceDependencyGoal::NoStop, *index)?;
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
        // PORT NOTE: reshaped for borrowck — capture `dev` raw before borrowing
        // `route_bundles[i]` so the `&mut DevServer` and `&mut RouteBundle`
        // borrows don't overlap (Zig had no aliasing check here).
        let dev_ptr: *mut DevServer = dev;
        let mut it = route_bits_client.iterator::<true, true>();
        while let Some(bundled_route_index) = it.next() {
            let bundle: &mut RouteBundle = &mut dev.route_bundles[bundled_route_index];
            bundle.invalidate_client_bundle(dev_ptr.cast());
        }
    } else if !dev.incremental_result.html_routes_hard_affected.is_empty() {
        // Free old bundles
        let dev_ptr: *mut DevServer = dev;
        let mut it = route_bits_client.iterator::<true, true>();
        while let Some(bundled_route_index) = it.next() {
            let bundle: &mut RouteBundle = &mut dev.route_bundles[bundled_route_index];
            bundle.invalidate_client_bundle(dev_ptr.cast());
        }
    }

    // Softly affected HTML routes only need the bundle invalidated.
    if !dev.incremental_result.html_routes_soft_affected.is_empty() {
        let dev_ptr: *mut DevServer = dev;
        for index in &dev.incremental_result.html_routes_soft_affected {
            // SAFETY: dev_ptr is live for the duration of this fn; reborrow to
            // avoid overlapping `&mut dev` with `&mut RouteBundle`.
            unsafe { &mut *dev_ptr }
                .route_bundle_ptr(*index)
                .invalidate_client_bundle(dev_ptr.cast());
            route_bits.set(index.get() as usize);
        }
        has_route_bits_set = true;
    }

    // `route_bits` will have all of the routes that were modified.
    if has_route_bits_set && (will_hear_hot_update || dev.incremental_result.had_adjusted_edges) {
        let mut it = route_bits.iterator::<true, true>();
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
                            // Arc<StaticRoute> drop = .deref()
                            drop(blob);
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

    let css_chunks = result.css_chunks();
    if will_hear_hot_update {
        if dev.client_graph.current_chunk_len > 0 || !css_chunks.is_empty() {
            // Send CSS mutations
            let asset_values = dev.assets.files.values();
            w_int!(u32, u32::try_from(css_chunks.len()).unwrap());
            use bun_bundler::Graph::InputFileListExt as _;
            let sources = bv2.graph.input_files.items_source();
            for chunk in css_chunks {
                let key = sources[chunk.entry_point.source_index() as usize]
                    .path
                    .key_for_incremental_graph();
                let mut hex = [0u8; 16];
                let n = bun_core::fmt::bytes_to_hex_lower(&hash(key).to_ne_bytes(), &mut hex);
                w_all!(&hex[..n]);
                let css_data = &asset_values[chunk.entry_point.entry_point_id() as usize]
                    .blob
                    .internal_blob()
                    .bytes;
                w_int!(u32, u32::try_from(css_data.len()).unwrap());
                w_all!(css_data);
            }

            // Send the JS chunk
            if dev.client_graph.current_chunk_len > 0 {
                let script_id = 'h: {
                    // `bundler.ContentHasher.Hash` = `std.hash.XxHash64`.
                    let mut source_map_hash = bun_hash::XxHash64Streaming::new(0x4b12);
                    let keys = dev.client_graph.bundled_files.keys();
                    let values = dev.client_graph.bundled_files.values();
                    for part in &dev.client_graph.current_chunk_parts {
                        source_map_hash.update(&keys[part.get() as usize]);
                        let _val = &values[part.get() as usize];
                        // TODO(port): `val.source_map.get().vlq()` once
                        // `packed_map::Shared::get()` is un-gated; until then
                        // the key hash omits the VLQ contribution.
                        let _: () = todo!("blocked_on: packed_map::Shared::get / PackedMap::vlq");
                    }
                    // Set the bottom bit.
                    break 'h source_map_store::Key::init(source_map_hash.digest() | 1);
                };
                let mut sockets: u32 = 0;
                for socket_ptr in dev.active_websocket_connections.keys() {
                    // SAFETY: socket_ptr is a valid *mut HmrSocket owned by the connection map
                    let socket = unsafe { &mut **socket_ptr };
                    if socket.is_subscribed(HmrTopic::HotUpdate) {
                        let entry = socket
                            .referenced_source_maps
                            .get_or_put(script_id)
                            .expect("oom");
                        if !entry.found_existing {
                            sockets += 1;
                        }
                        *entry.value_ptr = ();
                    }
                }
                map_log!("inc {:x}, for {} sockets", script_id.get(), sockets);
                let entry = match dev.source_maps.put_or_increment_ref_count(script_id, sockets)? {
                    source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => 'brk: {
                        // TODO(port): `take_source_map` is typed against the
                        // keystone `Entry`; the body-module `Entry` will unify
                        // once `source_map_store_body` is folded in.
                        let _ = &entry;
                        let _: () = todo!("blocked_on: source_map_store::Entry unification with source_map_store_body::Entry");
                        #[allow(unreachable_code)]
                        break 'brk entry;
                    }
                    source_map_store::PutOrIncrementRefCount::Shared(entry) => entry,
                };
                w_int!(u32, entry.overlapping_memory_cost);

                // Build and send the source chunk
                dev.client_graph.take_js_bundle_to_list(
                    &mut hot_update_payload,
                    &incremental_graph::TakeJSBundleOptionsClient {
                        kind: crate::bake::dev_server::ChunkKind::HmrChunk,
                        script_id,
                        console_log: dev.should_receive_console_log_from_browser(),
                        ..Default::default()
                    },
                )?;
            }
        } else {
            w_int!(i32, 0);
        }

        dev.publish(HmrTopic::HotUpdate, &hot_update_payload, Opcode::BINARY);
        had_sent_hmr_event = true;
    }

    if !dev.incremental_result.failures_added.is_empty() {
        dev.bundles_since_last_error = 0;

        // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
        let mut inspector_agent = unsafe { dev.inspector() };
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
            // SAFETY: `pop_first` hands back ownership of the intrusive node;
            // it stays alive until `deref_()` releases it below.
            let req = unsafe { &mut (*node).data };
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
            let clear_terminal = !bun_output::scope_is_visible!(DevServer)
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                && !unsafe { &*(*dev.vm).transpiler.env }
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
            let buf = paths::path_buffer_pool::get();

            // Compute a file name to display
            let file_name: Option<&[u8]> = if current_bundle.had_reload_event {
                if !bv2.graph.entry_points.is_empty() {
                    Some(dev.relative_path(&mut *buf, {
                        use bun_bundler::Graph::InputFileListExt as _;
                        &bv2.graph.input_files.items_source()
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
                        let first = current_bundle.requests.first;
                        if !first.is_null() {
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
                            Some(dev.relative_path(&mut *buf, &unsafe { &*html.html_bundle }.bundle.path))
                        }
                        route_bundle::Data::Framework(fw) => 'file_name: {
                            let route = dev.router.route_ptr(fw.route_index);
                            let opaque_id = match route.file_page.or(route.file_layout) {
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

        // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
        if let Some(_agent) = unsafe { dev.inspector() } {
            let _ = (dev.inspector_server_id, ms_elapsed as f64);
            todo!("blocked_on: bun_jsc::debugger::BunFrontendDevServerAgent::notify_bundle_complete");
        }
    }

    // Release the lock because the underlying handler may acquire one.
    dev.graph_safety_lock.unlock();
    let _relock = scopeguard::guard((), |_| dev.graph_safety_lock.lock());

    // Set all the deferred routes to the .loaded state up front
    {
        let mut node = current_bundle.requests.first;
        while !node.is_null() {
            // SAFETY: node is an intrusive list node valid while current_bundle.requests holds it
            let n = unsafe { &*node };
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
        // SAFETY: vm.event_loop() returns a valid `*mut EventLoop` for the VM lifetime.
        unsafe { &mut *vm.event_loop() }.enter();
        let _exit = scopeguard::guard((), |_| unsafe { &mut *vm.event_loop() }.exit());
        current_bundle.promise.strong.resolve(unsafe { &*vm.global }, JSValue::TRUE)?;
    }

    while let Some(node) = current_bundle.requests.pop_first() {
        // SAFETY: `pop_first` hands back ownership of the intrusive node;
        // it stays alive until `deref_()` releases it below.
        let req = unsafe { &mut (*node).data };
        let _deref = scopeguard::guard((), |_| req.deref_());

        let rb = dev.route_bundle_ptr(req.route_bundle_index);
        rb.server_state = route_bundle::State::Loaded;

        match &mut req.handler {
            Handler::Aborted => continue,
            Handler::ServerHandler(saved) => {
                let response = saved.response;
                dev.on_framework_request_with_bundle(
                    req.route_bundle_index,
                    // TODO(port): `SavedRequest` is move-only; Zig copied the
                    // pointer-only struct by value. Replace with by-value move
                    // once `Handler::ServerHandler` stores it by-value.
                    SavedRequestUnion::Saved(::core::mem::replace(
                        saved,
                        todo!("blocked_on: server::SavedRequest by-value move"),
                    )),
                    response,
                )?
            }
            Handler::BundledHtmlPage(ram) => {
                dev.on_html_request_with_bundle(req.route_bundle_index, ram.response, ram.method)
            }
        }
    }
    Ok(())
}

impl DevServer<'_> {
    fn start_next_bundle_if_present(&mut self) {
        debug_assert!(self.magic == Magic::Valid);
        // Clear the current bundle
        debug_assert!(self.current_bundle.is_none());
        self.emit_visualizer_message_if_needed();

        // If there were pending requests, begin another bundle.
        if self.next_bundle.reload_event.is_some()
            || !self.next_bundle.requests.first.is_null()
            || self.next_bundle.promise.strong.has_value()
        {
            // PERF(port): was stack-fallback (4096)
            let mut entry_points = EntryPointList::empty();

            let (is_reload, timer) = if let Some(event) = self.next_bundle.reload_event.take() {
                'brk: {
                    // SAFETY: event points into self.watcher_atomics.events[]
                    let event = unsafe { &mut *event };
                    let reload_event_timer = event.timer;

                    let self_ptr: *mut DevServer = self;
                    let mut current: &mut HotReloadEvent = event;
                    loop {
                        current.process_file_list(self_ptr.cast(), &mut entry_points);
                        let Some(next) = self
                            .watcher_atomics
                            .recycle_event_from_dev_server(current as *mut HotReloadEvent)
                        else {
                            break;
                        };
                        // SAFETY: `recycle_event_from_dev_server` returns a slot
                        // in `self.watcher_atomics.events[..]`, valid for `self`.
                        current = unsafe { &mut *next };
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

            self.next_bundle.route_queue.clear_retaining_capacity();
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
            "handleParseTaskFailure({}, .{}, {}, {} messages)",
            err.name(),
            <&'static str>::from(graph),
            bun_core::fmt::quote(abs_path),
            log.msgs.len(),
        );

        if err == bun_core::err!(FileNotFound) || err == bun_core::err!(ModuleNotFound) {
            // Special-case files being deleted.
            match graph {
                bake::Graph::Server | bake::Graph::Ssr => {
                    self.server_graph.on_file_deleted(abs_path, bv2)?
                }
                bake::Graph::Client => self.client_graph.on_file_deleted(abs_path, bv2)?,
            }
        } else {
            match graph {
                bake::Graph::Server => self
                    .server_graph
                    .insert_failure(incremental_graph::InsertFailureKey::AbsPath(abs_path), log, false)?,
                bake::Graph::Ssr => self
                    .server_graph
                    .insert_failure(incremental_graph::InsertFailureKey::AbsPath(abs_path), log, true)?,
                bake::Graph::Client => self
                    .client_graph
                    .insert_failure(incremental_graph::InsertFailureKey::AbsPath(abs_path), log, false)?,
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
        // `Owner::encode()` returns the body-module `Packed`; the keystone
        // `OwnerPacked` is layout-identical (`#[repr(transparent)] u32`).
        let owner: serialized_failure::OwnerPacked = if graph == bake::Graph::Client {
            let idx = self.client_graph.insert_stale(abs_path, false)?;
            serialized_failure::OwnerPacked::new(bake::Side::Client, incremental_graph::FileIndex::init(idx.get()))
        } else {
            let idx = self.server_graph.insert_stale(abs_path, graph == bake::Graph::Ssr)?;
            serialized_failure::OwnerPacked::new(bake::Side::Server, incremental_graph::FileIndex::init(idx.get()))
        };
        let current_bundle = self.current_bundle.as_mut().unwrap();
        let gop = current_bundle.resolution_failure_entries.get_or_put(owner)?;
        if !gop.found_existing {
            *gop.value_ptr = Log::init();
        }
        Ok(gop.value_ptr)
    }
}

pub struct CacheEntry {
    pub kind: FileKind,
}

impl DevServer<'_> {
    pub fn is_file_cached(&mut self, path: &[u8], side: bake::Graph) -> Option<CacheEntry> {
        // Barrel files with deferred records must always be re-parsed.
        // TODO(port): `ArrayHashMap<Box<[u8]>, ()>::contains_key` wants
        // `&Box<[u8]>`; no `Borrow<[u8]>` adapter yet, so linear-scan keys.
        if self
            .barrel_files_with_deferrals
            .keys()
            .iter()
            .any(|k| &**k == path)
        {
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
            OpaqueFileIdOrOptional::Optional(o) => match o {
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
impl From<OpaqueFileId> for OpaqueFileIdOrOptional {
    fn from(v: OpaqueFileId) -> Self { Self::Id(v) }
}
impl From<framework_router::OpaqueFileIdOptional> for OpaqueFileIdOrOptional {
    fn from(v: framework_router::OpaqueFileIdOptional) -> Self { Self::Optional(v) }
}

fn on_request<R>(dev: &mut DevServer, req: &mut Request, resp: &mut R)
where
    R: ResponseLike, // TODO(port): resp: anytype — bun_uws::ResponseLike once upstream lands
{
    let mut params: framework_router::MatchedParams = Default::default();
    if let Some(route_index) = dev.router.match_slow(req.url(), &mut params) {
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev,
            req: ReqOrSaved::Req(req),
            resp: resp.as_any_response(),
            kind: deferred_request::HandlerKind::ServerHandler,
            route_bundle_index: dev
                .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                .expect("oom"),
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(dev, rbi, &mut ctx) {
            Ok(()) => {}
            Err(e @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) =>
                // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
                unsafe { &*(*dev.vm).global }.report_active_exception_as_unhandled(e),
            Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
        }
        return;
    }

    if dev.server.as_ref().unwrap().config().on_request.is_some() {
        dev.server.as_mut().unwrap().on_request(req, resp.as_any_response());
        return;
    }

    send_built_in_not_found(resp);
}

impl DevServer<'_> {
    // TODO: path params
    pub fn handle_render_redirect(
        &mut self,
        saved_request: SavedRequest,
        render_path: &[u8],
        mut resp: AnyResponse,
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
            match ensure_route_is_bundled(self, rbi, &mut ctx) {
                Ok(()) => {}
                Err(jsc::JsError::OutOfMemory) => return Err(bun_core::err!(OutOfMemory).into()),
                Err(e @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) => {
                    // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
                    unsafe { &*(*self.vm).global }.report_active_exception_as_unhandled(e);
                }
            }
            return Ok(());
        }

        // No matching route found - render 404
        send_built_in_not_found(&mut resp);
        Ok(())
    }

    pub fn respond_for_html_bundle(
        &mut self,
        html: &mut HTMLBundleRoute,
        req: &mut Request,
        resp: AnyResponse,
    ) -> Result<(), AllocError> {
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev: self,
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::BundledHtmlPage,
            route_bundle_index: self
                .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))
                .map_err(|_| AllocError)?,
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(self, rbi, &mut ctx) {
            Ok(()) => {}
            Err(e @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) =>
                // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
                unsafe { &*(*self.vm).global }.report_active_exception_as_unhandled(e),
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
                &mut self.router.route_ptr_mut(*route_index).bundle
            }
            route_bundle::UnresolvedIndex::Html(html) => {
                // PORT NOTE: `UnresolvedIndex::Html` borrows `&HTMLBundleRoute`
                // (LIFETIMES.tsv BORROW_PARAM); Zig stored a `*HTMLBundle.Route`
                // and mutated through it. Cast away the shared borrow to obtain
                // the writable slot — the route outlives this call and is
                // single-threaded here.
                // SAFETY: see PORT NOTE above.
                unsafe {
                    &mut (*(*html as *const HTMLBundleRoute as *mut HTMLBundleRoute)).dev_server_id
                }
            }
        };
        // SAFETY: index_location points into self/html which outlive this fn
        if let Some(bundle_index) = unsafe { *index_location } {
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
                        cached_module_list: jsc::StrongOptional::empty(),
                        cached_client_bundle_url: jsc::StrongOptional::empty(),
                        cached_css_file_array: jsc::StrongOptional::empty(),
                    })
                }
                route_bundle::UnresolvedIndex::Html(html) => 'brk: {
                    let incremental_graph_index = self
                        .client_graph
                        .insert_stale_extra(&html.bundle.path, false, true)?;
                    let file =
                        &mut self.client_graph.bundled_files.values_mut()[incremental_graph_index.get() as usize];
                    // PORT NOTE: Zig packs/unpacks; the un-gated `incremental_graph::File`
                    // is unpacked already.
                    file.html_route_bundle_index = Some(bundle_index);
                    break 'brk route_bundle::Data::Html(route_bundle::Html {
                        // TODO(b2-blocked): bun_ptr::RefPtr<HTMLBundleRoute>::init_ref once RefCounted impl is real.
                        html_bundle: html as *const HTMLBundleRoute as *mut HTMLBundleRoute,
                        bundled_file: incremental_graph_index,
                        script_injection_offset: None,
                        cached_response: None,
                        bundled_html_text: None,
                    });
                }
            },
            client_script_generation: bun_core::fast_random() as u32,
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
        html: &mut HTMLBundleRoute,
    ) -> Result<(), bun_core::Error> {
        let _bundle_index = self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))?;
        // Our `HTMLRouter::fallback` is `Option<&HTMLBundleRoute>`; store the route ref.
        self.html_router.fallback = Some(html);
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

impl DevServer<'_> {
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
            unsafe { ::core::slice::from_raw_parts_mut(to_write_into.as_mut_ptr() as *mut u8, len) },
            &all_failures,
        );
        // SAFETY: `written` bytes of spare_capacity were initialized by encode() above
        unsafe { buf.set_len(buf.len() + written) };

        // Re-use the encoded buffer to avoid encoding failures more times than neccecary.
        if let Some(agent) = inspector_agent {
            debug_assert!(agent.is_enabled());
            let failures_encoded = &buf[failures_start_buf_pos..];
            // base64 output is pure ASCII so a UTF-8 borrow is byte-identical to
            // Zig's `BunString.initLatin1OrASCIIView`.
            let s = BunString::borrow_utf8(failures_encoded);
            let _deref = scopeguard::guard((), |_| s.deref());
            let _ = (&s, &agent, self.inspector_server_id);
            todo!("blocked_on: bun_jsc::debugger::BunFrontendDevServerAgent::notify_bundle_failed");
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
            bun_core::Global::package_json_version_with_canary,
            "\"};"
        );
        let post = "</script></body></html>";

        // PORT NOTE: split into `#[cfg]` branches so the `include_bytes!` arm
        // is not typechecked when `codegen_embed` is off (the codegen output
        // dir does not exist during a non-embed build).
        #[cfg(feature = "codegen_embed")]
        {
            buf.extend_from_slice(pre.as_bytes());
            buf.extend_from_slice(include_bytes!("bake-codegen/bake.error.js"));
            buf.extend_from_slice(post.as_bytes());
        }
        #[cfg(not(feature = "codegen_embed"))]
        {
            buf.extend_from_slice(pre.as_bytes());
            buf.extend_from_slice(bun_core::runtime_embed_file(
                bun_core::EmbedKind::CodegenEager,
                "bake.error.js",
            ).as_bytes());
            buf.extend_from_slice(post.as_bytes());
        }

        match resp {
            DevResponse::Http(r) => StaticRoute::send_blob_then_deinit(
                r,
                &crate::webcore::blob::Any::from_array_list(buf),
                crate::server::static_route::InitFromBytesOptions {
                    mime_type: Some(&MimeType::HTML),
                    server: self.server,
                    status_code: 500,
                    ..Default::default()
                },
            ),
            DevResponse::Promise(mut r) => {
                let global = r.global;
                let mut any_blob = crate::webcore::blob::Any::from_array_list(buf);
                // TODO(b2-blocked): bun_http::Headers::from wants a webcore Body view; the
                // body-aware path is gated. Pass None and append Content-Type manually.
                let mut headers = bun_http::Headers::from(None, bun_http::headers::Options { body: None });
                headers.append(b"Content-Type", &MimeType::HTML.value);
                if headers.get(b"etag").is_none() {
                    if !any_blob.slice().is_empty() {
                        let _ = (&any_blob, &mut headers);
                        todo!("blocked_on: bun_http::ETag::append_to_headers (bun_http::Headers vs bun_http_types::ETag::Headers)");
                    }
                }
                let _ = (&mut headers, global);
                let mut response: Response =
                    todo!("blocked_on: bun_http::Headers::to_fetch_headers / webcore::response construction");
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                let vm = unsafe { &*self.vm };
                // SAFETY: event_loop() returns *mut EventLoop owned by vm; valid for vm lifetime
                unsafe { (*vm.event_loop()).enter() };
                let _exit = scopeguard::guard((), |_| unsafe { (*vm.event_loop()).exit() });
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

impl DevServer<'_> {
    fn print_memory_line(&self) {
        // TODO(port): bun_alloc::AllocationScope has no `ENABLED`/`stats()` yet.
        if !ALLOCATION_SCOPE_ENABLED {
            return;
        }
        if !bun_output::scope_is_visible!(DevServer) {
            return;
        }
        Output::pretty_errorln(format_args!(
            "<d>DevServer tracked {}, process: {}<r>",
            bun_core::fmt::size(self.memory_cost(), Default::default()),
            bun_core::fmt::size(sys::self_process_memory_usage().unwrap_or(0), Default::default()),
        ));
        todo!("blocked_on: bun_alloc::AllocationScope::stats");
    }
}

// PORT NOTE: FileKind/ChunkKind/TraceImportGoal/IncrementalResult/GraphTraceState
// are defined once in `crate::bake::dev_server` and re-exported here so the
// Phase-A draft body and the keystone struct module agree on identity.
pub use crate::bake::dev_server::FileKind;

/// Shim for `bun_alloc::AllocationScope::ENABLED` until that const lands upstream.
pub(crate) const ALLOCATION_SCOPE_ENABLED: bool = false;

pub use crate::bake::dev_server::IncrementalResult;

/// Used during an incremental update to determine what "HMR roots"
/// are affected. Re-exported from the keystone `dev_server` module so that
/// `HotUpdateContext.gts` and `IncrementalGraph::trace_dependencies` agree on
/// a single type (the body-local duplicate caused E0308).
pub use crate::bake::dev_server::GraphTraceState;

// GraphTraceState::deinit → Drop on DynamicBitSet (allocator param dropped)

pub use crate::bake::dev_server::TraceImportGoal;

impl DevServer<'_> {
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

// PORT NOTE: canonical `ChunkKind` lives in `crate::bake::dev_server`; the
// body module re-exports it so both modules name the same type.
pub use crate::bake::dev_server::ChunkKind;

// For debugging, it is helpful to be able to see bundles.
pub fn dump_bundle(
    dump_dir: &mut sys::Dir,
    graph: bake::Graph,
    rel_path: &[u8],
    chunk: &[u8],
    wrap: bool,
) -> Result<(), bun_core::Error> {
    let mut buf = paths::path_buffer_pool::get();
    let name = &paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
        b"/",
        &mut *buf,
        &[<&'static str>::from(graph).as_bytes(), rel_path],
    )[1..];
    // TODO(port): std.fs.Dir.makeOpenPath / createFile — use bun_sys
    let mut inner_dir = dump_dir.make_open_path(
        paths::resolve_path::dirname::<paths::platform::Auto>(name),
        Default::default(),
    )?;

    // PORT NOTE: std.fs.Dir.createFile -> openat(CREAT|TRUNC|WRONLY).
    let file = sys::File::openat(
        inner_dir.fd,
        paths::basename(name),
        sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
        0o664,
    )?;
    let mut bufw = file.buffered_writer();

    if !strings::has_suffix_comptime(rel_path, b".map") {
        write!(
            bufw,
            "// {} bundled for {}\n",
            bun_core::fmt::quote(rel_path),
            <&'static str>::from(graph),
        )?;
        write!(
            bufw,
            "// Bundled at {}, Bun {}\n",
            bun_core::time::nano_timestamp(),
            bun_core::Global::package_json_version_with_canary,
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
    let rel_path = paths::resolve_path::relative_buf_z(&mut a, cwd, key);
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

impl DevServer<'_> {
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

        self.publish(HmrTopic::IncrementalVisualizer, &payload, Opcode::BINARY);
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
        timer.state = bun_event_loop::EventLoopTimer::State::FIRED;
        // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
        let _ = (timer, dev.vm);
        todo!("blocked_on: bun_jsc::VirtualMachine::timer (field is `()` placeholder)");
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
        debug_assert!(cfg!(feature = "bake_debugging_features"));
        debug_assert!(self.emit_memory_visualizer_events > 0);

        // PERF(port): was stack-fallback (65536)
        let mut payload: Vec<u8> = Vec::with_capacity(65536);
        payload.push(MessageId::MemoryVisualizer.char());
        if self.write_memory_visualizer_message(&mut payload).is_err() {
            return; // drop packet
        }
        self.publish(HmrTopic::MemoryVisualizer, &payload, Opcode::BINARY);
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
        let _cost = self.memory_cost_detailed();
        let system_total = crate::node::os::totalmem();
        // TODO(b2-blocked): `memory_cost_detailed` returns `()` placeholder until
        // `dev_server::memory_cost_body` is un-gated. Emit zeros so the wire shape stays.
        let fields = Fields {
            incremental_graph_client: 0,
            incremental_graph_server: 0,
            js_code: 0,
            source_maps: 0,
            assets: 0,
            other: 0,
            devserver_tracked: if ALLOCATION_SCOPE_ENABLED {
                todo!("blocked_on: bun_alloc::AllocationScope::stats")
            } else {
                0
            },
            process_used: sys::self_process_memory_usage().unwrap_or(0) as u32,
            system_used: system_total.saturating_sub(crate::node::os::freemem()) as u32,
            system_total: system_total as u32,
        };
        // SAFETY: Fields is repr(C) POD
        payload.extend_from_slice(unsafe {
            ::core::slice::from_raw_parts(
                &fields as *const _ as *const u8,
                ::core::mem::size_of::<Fields>(),
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
                // TODO(b2-blocked): `SourceMapStore::locate_weak_ref` + `Entry.overlapping_memory_cost`
                // live in the gated `source_map_store_body`; emit zero placeholders so wire stays in sync.
                let _ = value;
                payload.extend_from_slice(&0u32.to_le_bytes());
                payload.extend_from_slice(&0u32.to_le_bytes());
                payload.extend_from_slice(&0u32.to_le_bytes());
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
                    // PORT NOTE: un-gated `incremental_graph::File` is unpacked already.
                    let file = v;
                    let mut buf = paths::path_buffer_pool::get();
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

        // TODO(b2-blocked): `incremental_graph::IncrementalGraph` keystone has no
        // `edges_free_list`/iterable `edges` yet (lives in `incremental_graph_body`).
        // Emit zero-length edge sections so the wire shape stays valid.
        payload.extend_from_slice(&0u32.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());
        let _ = (&self.client_graph, &self.server_graph);
        Ok(())
    }

    pub fn on_web_socket_upgrade<R>(
        &mut self,
        res: &mut R,
        req: &mut Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) where
        R: ResponseLike, // TODO(port): bun_uws::ResponseLike once upstream lands
    {
        debug_assert!(id == 0);

        // TODO(b2-blocked): `dev_server::HmrSocket` keystone has no `new()`;
        // full body lives in `dev_server::hmr_socket_body::HmrSocket`. Shim until
        // the two HmrSocket shapes are unified.
        let dw: Box<HmrSocket> = todo!("blocked_on: dev_server::HmrSocket unification with hmr_socket_body");
        let dw_ptr: *mut HmrSocket = Box::into_raw(dw);
        self.active_websocket_connections.put_no_clobber(dw_ptr, ()).expect("oom");
        res.upgrade::<*mut HmrSocket>(
            dw_ptr,
            req.header(b"sec-websocket-key").unwrap_or(b""),
            req.header(b"sec-websocket-protocol").unwrap_or(b""),
            req.header(b"sec-websocket-extension").unwrap_or(b""),
            upgrade_ctx,
        );
    }
}

// PORT NOTE: MessageId/IncomingMessageId/ConsoleLogKind/HmrTopic are defined
// once in `crate::bake::dev_server` and re-exported here.
pub use crate::bake::dev_server::{MessageId, IncomingMessageId, ConsoleLogKind, HmrTopic};

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

impl DevServer<'_> {
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

impl DevServer<'_> {
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

    /// SAFETY: returns `&mut BunFrontendDevServerAgent` derived through the
    /// `UnsafeCell` on `Debugger.frontend_dev_server_agent`; two calls alias
    /// the same agent. Caller must not hold another live `&mut` to it.
    /// JS-thread only.
    pub unsafe fn inspector(&self) -> Option<&mut BunFrontendDevServerAgent> {
        // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
        if let Some(debugger) = unsafe { &*self.vm }.debugger.as_ref() {
            #[cold]
            fn cold() {}
            cold();
            // SAFETY: `frontend_dev_server_agent` is `UnsafeCell`-wrapped for
            // interior mutability (Zig spec returns `*Agent` from `*const
            // DevServer`). JS-thread only; caller upholds the no-alias
            // contract documented above.
            let agent = unsafe { &mut *debugger.frontend_dev_server_agent.get() };
            if agent.is_enabled() {
                cold();
                return Some(agent);
            }
        }
        None
    }

    /// Called on watcher's thread; Access to dev-server state restricted.
    pub fn on_file_update(
        &mut self,
        events: &[bun_watcher::Event],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: bun_watcher::ItemList,
    ) {
        debug_assert!(self.magic == Magic::Valid);
        debug_log!("onFileUpdate start");
        let _end = scopeguard::guard((), |_| debug_log!("onFileUpdate end"));

        let mut slice = watchlist.slice();
        let file_paths = slice.items_file_path();
        // SAFETY: column 4 (`Count`) is `u32` per `WatchItemField`.
        let counts: &mut [u32] =
            unsafe { slice.items_mut::<u32>(bun_watcher::WatchItemField::Count) };
        let kinds = slice.items_kind();

        let ev_ptr = self.watcher_atomics.watcher_acquire_event();
        // SAFETY: `watcher_acquire_event` returns a valid `*mut HotReloadEvent`
        // into `self.watcher_atomics.events`; exclusive on the watcher thread.
        let ev = unsafe { &mut *ev_ptr };
        let _release =
            scopeguard::guard((), |_| self.watcher_atomics.watcher_release_and_submit_event(ev_ptr));

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
                    if event.op.contains(bun_watcher::Op::DELETE)
                        || event.op.contains(bun_watcher::Op::RENAME)
                    {
                        // TODO: audit this line heavily
                        self.bun_watcher
                            .remove_at_index(bun_watcher::Kind::File, event.index, 0, &[]);
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
                                ev.append_dir(file_path, maybe_sub_path.map(|s| s.as_bytes()));
                            }
                        } else {
                            ev.append_dir(file_path, None);
                        }
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        let _ = changed_files;
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
                "failed to watch {} for hot-reloading",
                (bun_core::fmt::quote(&err.path),),
            );
        } else {
            Output::err(err, "failed to watch files for hot-reloading", ());
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
        unsafe { ::core::mem::transmute((self.0 & 1) as u8) }
    }
    fn index(self) -> u32 {
        (self.0 >> 1) & 0x3FFF_FFFF
    }
}

impl DevServer<'_> {
    /// Interface function for FrameworkRouter
    pub fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: framework_router::RouteIndex,
        file_kind: framework_router::FileKind,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        let index = self.server_graph.insert_stale_extra(abs_path, false, true)
            .map_err(bun_core::Error::from)?;
        self.route_lookup.put(
            index,
            RouteIndexAndRecurseFlag::new(
                associated_route,
                file_kind == framework_router::FileKind::Layout,
            ),
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
        ty: framework_router::FileKind,
    ) -> Result<(), AllocError> {
        // TODO: maybe this should track the error, send over HmrSocket?
        Output::err_generic(
            "Multiple {} matching the same route pattern is ambiguous",
            (match ty {
                framework_router::FileKind::Page => "pages",
                framework_router::FileKind::Layout => "layout",
            },),
        );
        Output::pretty_errorln(format_args!("  - <blue>{}<r>", bstr::BStr::new(rel_path)));
        let mut buf = paths::path_buffer_pool::get();
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
        return incremental_graph::FileIndex::<SIDE>::init(safe.index());
    }
    incremental_graph::FileIndex::<SIDE>::init(u32::try_from(id.get()).unwrap())
}

impl DevServer<'_> {
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

        let rel = bun_paths::resolve_path::relative_platform_buf::<
            bun_paths::resolve_path::platform::Auto,
            true,
        >(&mut relative_path_buf[..], &self.root, path);
        // SAFETY: `rel` is owned by relative_path_buf, which is mutable
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(unsafe {
            ::core::slice::from_raw_parts_mut(rel.as_ptr() as *mut u8, rel.len())
        });
        rel
    }

    /// Either of two conditions make this true:
    /// - The inspector is enabled
    /// - The user passed "console": true in serve options
    fn should_receive_console_log_from_browser(&self) -> bool {
        // SAFETY: read-only check; agent borrow not retained.
        unsafe { self.inspector() }.is_some() || self.broadcast_console_log_from_browser_to_server
    }
}

fn dump_state_due_to_crash(dev: &mut DevServer) -> Result<(), bun_core::Error> {
    debug_assert!(cfg!(feature = "bake_debugging_features"));

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
        match filepath_buf.iter().position(|&b| b == 0) {
            Some(nul) => &filepath_buf[..nul],
            None => b"incremental-graph-crash-dump.html".as_slice(),
        }
    };
    // TODO(port): std.fs.cwd().createFileZ — use bun_sys
    let file = match sys::File::create(sys::Fd::cwd(), filepath, true) {
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

    // bun_base64::encode_len_from_size(4096) == ((4096 + 2) / 3) * 4 == 5464
    let mut buf = [0u8; 5464];
    for chunk in payload.chunks(4096) {
        file.write_all(&buf[..bun_base64::encode(&mut buf, chunk)])?;
    }

    file.write_all(b"\"), c => c.charCodeAt(0));\n")?;
    file.write_all(end)?;

    Output::note(format_args!(
        "Dumped incremental bundler graph to {}",
        bun_core::fmt::quote(filepath)
    ));
    Ok(())
}

// TODO(port): packed struct(u32) — Route.Index is 31 bits + 1 bool bit
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct RouteIndexAndRecurseFlag(u32);
impl RouteIndexAndRecurseFlag {
    pub fn new(route_index: framework_router::RouteIndex, should_recurse_when_visiting: bool) -> Self {
        RouteIndexAndRecurseFlag(
            (route_index.get() & 0x7FFF_FFFF) | ((should_recurse_when_visiting as u32) << 31),
        )
    }
    pub fn route_index(self) -> framework_router::RouteIndex {
        framework_router::RouteIndex::init(self.0 & 0x7FFF_FFFF)
    }
    pub fn should_recurse_when_visiting(self) -> bool {
        (self.0 >> 31) != 0
    }
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
    pub fn empty() -> EntryPointList { EntryPointList { set: ArrayHashMap::new() } }

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
        let gop = self.set.get_or_put(Box::<[u8]>::from(abs_path))?;
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
pub struct HTMLRouter<'a> {
    pub map: StringHashMap<&'a HTMLBundleRoute>,
    /// If a catch-all route exists, it is not stored in map, but here.
    pub fallback: Option<&'a HTMLBundleRoute>,
}

impl<'a> HTMLRouter<'a> {
    pub fn empty() -> HTMLRouter<'a> { HTMLRouter { map: StringHashMap::new(), fallback: None } }

    pub fn get(&self, path: &[u8]) -> Option<&'a HTMLBundleRoute> {
        self.map.get(path).copied().or(self.fallback)
    }

    pub fn put(
        &mut self,
        path: &[u8],
        route: &'a HTMLBundleRoute,
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

impl DevServer<'_> {
    pub fn put_or_overwrite_asset(
        &mut self,
        path: &bun_bundler::bun_fs::Path<'_>,
        contents: &crate::webcore::blob::Any,
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
        plugins: Option<*mut crate::api::js_bundler::Plugin>,
    ) -> Result<(), bun_core::Error> {
        self.bundler_options.plugin = plugins.and_then(|p| ::core::ptr::NonNull::new(p as *mut _));
        self.plugin_state = PluginState::Loaded;
        self.start_next_bundle_if_present();
        Ok(())
    }

    pub fn on_plugins_rejected(&mut self) -> Result<(), bun_core::Error> {
        self.plugin_state = PluginState::Err;
        while let Some(item) = self.next_bundle.requests.pop_first() {
            // SAFETY: `pop_first` returns a valid `*mut Node<DeferredRequest>`.
            unsafe {
                (*item).data.abort();
                (*item).data.deref_();
            }
        }
        self.next_bundle.route_queue.clear_retaining_capacity();
        // TODO: allow recovery from this state
        Ok(())
    }
}

/// Problem statement documented on `SCRIPT_UNREF_PAYLOAD`
/// Takes 8 bytes: The generation ID in hex.
struct UnrefSourceMapRequest {
    // BACKREF: DevServer outlives the request; raw ptr avoids the `'static`
    // bound on `BodyReaderHandler` that a borrowed `&'a mut DevServer<'a>` would violate.
    dev: *mut DevServer<'static>,
    body: uws::BodyReaderMixin<Self>, // TODO(port): BodyReaderMixin(@This(), "body", runWithBody, finalize)
}

impl bun_uws_sys::body_reader_mixin::BodyReaderHandler for UnrefSourceMapRequest {
    const MIXIN_OFFSET: usize = offset_of!(UnrefSourceMapRequest, body);
    fn on_body(&mut self, body: &[u8], resp: AnyResponse) -> Result<(), bun_core::Error> {
        Self::run_with_body(self, body, resp)
    }
    fn on_error(&mut self) {
        Self::finalize(self as *mut _);
    }
}

impl UnrefSourceMapRequest {
    fn run<R>(dev: &mut DevServer, _: &mut Request, resp: &mut R)
    where
        R: bun_uws_sys::body_reader_mixin::BodyResponse,
    {
        let ctx = Box::new(UnrefSourceMapRequest {
            dev: dev as *mut DevServer<'_> as *mut DevServer<'static>,
            body: uws::BodyReaderMixin::init(),
        });
        // SAFETY: dev outlives the request
        unsafe { (*ctx.dev).server.as_mut().unwrap().on_pending_request() };
        // TODO(port): ctx is leaked into the body reader; freed in finalize()
        let raw = Box::into_raw(ctx);
        uws::BodyReaderMixin::<Self>::read_body(raw, resp);
    }

    fn finalize(ctx: *mut UnrefSourceMapRequest) {
        // SAFETY: ctx was Box::into_raw'd in run()
        let ctx = unsafe { Box::from_raw(ctx) };
        // SAFETY: dev outlives the request
        unsafe { (*ctx.dev).server.as_mut().unwrap().on_static_request_complete() };
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
        strings::decode_hex_to_bytes(&mut generation_bytes, body)
            .map_err(|_| bun_core::err!(InvalidRequest))?;
        let generation = u32::from_ne_bytes(generation_bytes);
        let source_map_key = source_map_store::Key::init((generation as u64) << 32);
        // SAFETY: dev outlives the request
        let _ = unsafe { &mut *ctx.dev }
            .source_maps
            .remove_or_upgrade_weak_ref(source_map_key, source_map_store::RemoveOrUpgradeMode::Remove);
        r.write_status(b"204 No Content");
        r.end(b"", false);
        Ok(())
    }
}

// PORT NOTE: Zig used `anytype` reader (`.readInt(u32, .little)`, `.readNoEof`).
// The only caller (`ErrorReportRequest`) reads from a `&[u8]` body slice, so this
// is specialized to a slice cursor — matching the local zero-copy variant there.
pub fn read_string32(reader: &mut &[u8]) -> Result<Box<[u8]>, bun_core::Error> {
    if reader.len() < 4 {
        return Err(bun_core::err!("EndOfStream"));
    }
    let (len_bytes, rest) = reader.split_at(4);
    let len = u32::from_le_bytes([len_bytes[0], len_bytes[1], len_bytes[2], len_bytes[3]]) as usize;
    if rest.len() < len {
        return Err(bun_core::err!("EndOfStream"));
    }
    let (data, tail) = rest.split_at(len);
    *reader = tail;
    Ok(data.to_vec().into_boxed_slice())
}

pub struct TestingBatch {
    /// Keys are borrowed. See doc comment in Zig source.
    pub entry_points: EntryPointList,
}

impl TestingBatch {
    pub fn empty() -> TestingBatch { TestingBatch { entry_points: EntryPointList::empty() } }

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
static DEV_SERVER_DEINIT_COUNT_FOR_TESTING: ::core::sync::atomic::AtomicUsize =
    ::core::sync::atomic::AtomicUsize::new(0);
pub fn get_deinit_count_for_testing() -> usize {
    DEV_SERVER_DEINIT_COUNT_FOR_TESTING.load(::core::sync::atomic::Ordering::Relaxed)
}

struct PromiseEnsureRouteBundledCtx<'a> {
    dev: &'a mut DevServer<'a>,
    global: &'a JSGlobalObject,
    promise: Option<jsc::JSPromiseStrong>,
    p: Option<*mut jsc::JSPromise>, // BORROW_FIELD: from sibling self.promise
    already_loaded: bool,
    route_bundle_index: route_bundle::Index,
}

impl<'a> PromiseEnsureRouteBundledCtx<'a> {
    fn ensure_promise(&mut self) -> jsc::JSPromiseStrong {
        if self.promise.is_none() {
            let strong = jsc::JSPromiseStrong::init(self.global);
            // SAFETY: resolver-style accessor; only stored as raw ptr.
            self.p = Some(unsafe { strong.get() } as *mut _);
            self.promise = Some(strong);
        }
        let _value = self.promise.as_ref().unwrap().value();
        todo!("blocked_on: bun_jsc::JSPromiseStrong::from_value")
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
                    // SAFETY: sole `&mut JSPromise` borrow; stored as raw pointer.
                    self.p = Some(unsafe { cb.promise.strong.get() });
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
                    // SAFETY: sole `&mut JSPromise` borrow; stored as raw pointer.
                    self.p = Some(unsafe { self.dev.next_bundle.promise.strong.get() });
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
        unsafe { &mut *(self.dev.vm as *mut VirtualMachine) }.drain_microtasks();
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
        let failures = ::core::slice::from_ref(failure);
        self.dev.send_serialized_failures(
            DevResponse::Promise(promise_response),
            failures,
            ErrorPageKind::Evaluation,
            None,
        )?;
        Ok(())
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        let _ = self.ensure_promise();
        // SAFETY: p was set by ensure_promise
        unsafe { &mut *self.p.unwrap() }
            .reject(self.global, BunString::static_("Plugin error").to_js(self.global))?;
        // SAFETY: dev.vm is JSC_BORROW — valid for DevServer lifetime
        unsafe { &mut *(self.dev.vm as *mut VirtualMachine) }.drain_microtasks();
        Ok(())
    }

    fn to_dev_response(&mut self) -> DevResponse {
        DevResponse::Promise(PromiseResponse {
            promise: self.ensure_promise(),
            global: self.global,
        })
    }
}

impl<'a> EnsureRouteCtx for PromiseEnsureRouteBundledCtx<'a> {
    fn on_defer(&mut self, bundle_field: BundleQueueType) -> JsResult<()> {
        PromiseEnsureRouteBundledCtx::on_defer(self, bundle_field)
    }
    fn on_loaded(&mut self) -> JsResult<()> {
        PromiseEnsureRouteBundledCtx::on_loaded(self)
    }
    fn on_failure(&mut self) -> JsResult<()> {
        PromiseEnsureRouteBundledCtx::on_failure(self)
    }
    fn on_plugin_error(&mut self) -> JsResult<()> {
        PromiseEnsureRouteBundledCtx::on_plugin_error(self)
    }
    fn to_dev_response(&mut self) -> DevResponse {
        PromiseEnsureRouteBundledCtx::to_dev_response(self)
    }
    fn dev(&mut self) -> &mut DevServer {
        // SAFETY: lifetime erased to satisfy the trait's invariant signature;
        // borrow does not outlive `self`.
        unsafe { ::core::mem::transmute::<&mut DevServer<'a>, &mut DevServer<'_>>(&mut *self.dev) }
    }
    fn route_bundle_index(&self) -> route_bundle::Index {
        self.route_bundle_index
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bake__bundleNewRouteJSFunctionImpl(
    global: &JSGlobalObject,
    request_ptr: *mut c_void,
    url: BunString,
) -> JSValue {
    jsc::to_js_host_call(global, bundle_new_route_js_function_impl(global, request_ptr, url))
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
        return Err(global.throw("Request context does not belong to dev server"));
    };
    // Extract pathname from URL (remove protocol, host, query, hash)
    let pathname = extract_pathname_from_url(url.slice());

    if pathname.is_empty() || pathname[0] != b'/' {
        return Err(global.throw(
            format_args!(
                "Invalid path \"{}\" it should be non-empty and start with a slash",
                bstr::BStr::new(pathname)
            ),
        ));
    }

    let mut params: framework_router::MatchedParams = Default::default();
    let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
        return Err(global.throw(
            format_args!("No route found for path: {}", bstr::BStr::new(pathname)),
        ));
    };

    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
    let vm = unsafe { &*dev.vm };
    // SAFETY: `event_loop()` returns a stable raw pointer; deref for &mut.
    unsafe { (*vm.event_loop()).enter() };
    let _exit = scopeguard::guard((), |_| unsafe { (*vm.event_loop()).exit() });

    // TODO(port): `AnyRequestContext::dev_server()` returns the keystone
    // `&dev_server::DevServer`, but this body needs `&mut dev_server_body::DevServer`
    // (different struct + mutability). Shadow until the two types are unified.
    let _ = dev;
    let dev: &mut DevServer =
        todo!("blocked_on: AnyRequestContext::dev_server -> &mut dev_server_body::DevServer");

    let route_bundle_index = dev
        .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
        .expect("oom");
    let mut ctx = PromiseEnsureRouteBundledCtx {
        dev,
        global,
        promise: None,
        p: None,
        already_loaded: false,
        route_bundle_index,
    };

    let rbi = ctx.route_bundle_index;
    // SAFETY: `ctx.dev` aliases the same DevServer; Zig passed both freely.
    // Reborrow via raw ptr to satisfy borrowck while ctx is also &mut-borrowed.
    let dev_ptr: *mut DevServer = ctx.dev;
    ensure_route_is_bundled(unsafe { &mut *dev_ptr }, rbi, &mut ctx)?;

    let array = JSValue::create_empty_array(global, 2)?;

    array.put_index(global, 0, JSValue::js_number_from_uint64(rbi.get() as u64))?;

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
    jsc::to_js_host_call(
        global,
        new_route_params_for_bundle_promise_for_js(global, callframe),
    )
}

fn new_route_params_for_bundle_promise_for_js(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    if callframe.arguments_count() != 3 {
        return Err(global.throw("Expected 3 arguments"));
    }

    let request_js = callframe.argument(0);
    let route_bundle_index_js = callframe.argument(1);
    let url_js = callframe.argument(2);

    if !request_js.is_object() {
        return Err(global.throw("Request must be an object"));
    }
    if !route_bundle_index_js.is_any_int() {
        return Err(global.throw("Route bundle index must be an integer"));
    }
    if !url_js.is_string() {
        return Err(global.throw("URL must be a string"));
    }

    // TODO(port): `webcore::Request` has no `JsClass` impl yet, so
    // `JSValue::as_::<WebRequest>()` is unavailable. Recover the native
    // pointer once Request's classes-codegen lands.
    let _ = request_js;
    let request: &mut WebRequest = todo!("blocked_on: webcore::Request JsClass impl");
    let Some(_keystone_dev) = request.request_context.dev_server() else {
        return Err(global.throw("Request context does not belong to dev server"));
    };
    // TODO(port): `AnyRequestContext::dev_server()` returns the keystone
    // `&dev_server::DevServer`; this body needs `&mut dev_server_body::DevServer`.
    let dev: &mut DevServer =
        todo!("blocked_on: AnyRequestContext::dev_server -> &mut dev_server_body::DevServer");

    let route_bundle_index =
        route_bundle::Index::init(u32::try_from(route_bundle_index_js.to_int32()).unwrap());

    let url = url_js.to_bun_string(global)?;
    let _deref = scopeguard::guard((), |_| url.deref());
    let url_utf8 = url.to_utf8();

    new_route_params_for_bundle_promise(dev, route_bundle_index, url_utf8.slice())
}

fn new_route_params_for_bundle_promise(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    url: &[u8],
) -> JsResult<JSValue> {
    let route_bundle = dev.route_bundle_ptr(route_bundle_index);
    let framework_bundle = match &mut route_bundle.data {
            route_bundle::Data::Framework(f) => f,
            _ => unreachable!(),
        };

    let pathname = extract_pathname_from_url(url);

    // SAFETY: vm is JSC_BORROW; vm.global is valid for VM lifetime
    let global = unsafe { &*(*dev.vm).global };
    let mut params: framework_router::MatchedParams = Default::default();
    let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
        return Err(global.throw(format_args!(
            "No route found for path: {}",
            bstr::BStr::new(pathname)
        )));
    };
    if route_index != framework_bundle.route_index {
        return Err(global.throw(format_args!(
            "Route index mismatch, expected {} but got {}",
            framework_bundle.route_index.get(),
            route_index.get()
        )));
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
use crate::bake::dev_server::route_bundle;
use crate::bake::dev_server::serialized_failure;
use crate::bake::dev_server::source_map_store;
use crate::bake::dev_server::incremental_graph;
type DebuggerId = jsc::debugger::DebuggerId;
type BunFrontendDevServerAgent = jsc::debugger::BunFrontendDevServerAgent;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer.zig (4783 lines)
//   confidence: low
//   todos:      76
//   notes:      Heavy borrowck reshaping needed in Phase B: init() late-init fields now use Box<MaybeUninit<DevServer>> + addr_of_mut!().write() per field; DevServer/HTMLRouter/PromiseResponse now carry `<'a>` per LIFETIMES.tsv but impl blocks still need the param threaded; many scopeguard closures capture &mut dev across other &mut borrows; finalize_bundle has self-referential ptrs into dev. ensure_route_is_bundled uses trait pattern for Zig comptime Ctx duck-typing. Several `anytype` params (set_routes, on_request, on_src_request) bound by placeholder traits.
// ──────────────────────────────────────────────────────────────────────────
