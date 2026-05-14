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
use bun_bundler::mal_prelude::*;
use bun_collections::{ByteVecExt, VecExt};
use std::io::Write as _;
use std::time::Instant;

use bun_alloc::{AllocError, Arena};
use bun_ast::Log;
use bun_bundler::options_impl::TargetExt as _;
use bun_collections::{
    ArrayHashMap, AutoBitSet, DynamicBitSet, HashMap, HiveArrayFallback, StringHashMap,
};
use bun_core::{self as core, Environment, Output};
use bun_core::{self as str, OwnedString, String as BunString, ZStr, strings};
use bun_jsc::StringJsc as _;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, Strong};
use bun_paths::{self as paths, MAX_PATH_BYTES, PathBuffer};
use bun_sys as sys;
use bun_uws::{
    self as uws, AnyResponse, Opcode, Request, WebSocketBehavior, WebSocketUpgradeContext,
};
use bun_watcher::WatchItemColumns as _;
use bun_wyhash::{Wyhash, hash};

use crate::api::server::StaticRoute;
use crate::api::{AnyServer, HTMLBundle, JSBundler, SavedRequest};
use crate::bake;
use crate::bake::framework_router::{
    self as framework_router, FrameworkRouter, OpaqueFileId, Route,
};
use crate::server::html_bundle::HTMLBundleRoute;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use crate::webcore::{Blob, Request as WebRequest, Response};
use bun_ast::Loader;
use bun_ast::{ImportKind, ImportRecord};
use bun_bundler::{self as bundler, BundleV2, Transpiler};
use bun_http::{Method, MimeType};
use bun_safety::ThreadLock;
use bun_sourcemap::SourceMap;
use bun_watcher::Watcher;

pub use crate::bake::dev_server::DirectoryWatchStore;
pub use crate::bake::dev_server::HmrSocket;
use crate::bake::dev_server::ResponseLike;
pub use crate::bake::dev_server::assets::Assets;
pub use crate::bake::dev_server::error_report_request_body::ErrorReportRequest;

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
// LAYERING: `bake::Framework::{init_transpiler, resolve}` are now inherent
// methods on the keystone `bake::Framework` (ported into `bake/mod.rs` from
// `bake_body::Framework` so this file can call them without the trait shim).

/// Shim: `bun_ast::Log::to_js_aggregate_error` — body lives in `bun_logger_jsc`.
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
        global: &JSGlobalObject,
        msg: BunString,
    ) -> JsResult<JSValue> {
        bun_ast_jsc::log_to_js_aggregate_error(self, global, msg)
    }
}
pub use crate::bake::dev_server::HotReloadEvent;
pub use crate::bake::dev_server::incremental_graph::IncrementalGraph;
pub use crate::bake::dev_server::memory_cost_body::MemoryCost;

impl DevServer {
    /// `DevServer.memoryCost` — sums the per-category breakdown from
    /// `memory_cost_detailed`. Body lives in `dev_server::memory_cost_body`
    /// (mirrors Zig `pub const memoryCost = MemoryCost.memoryCost;`).
    #[inline]
    pub fn memory_cost(&self) -> usize {
        crate::bake::dev_server::memory_cost_body::memory_cost(self)
    }

    /// `DevServer.memoryCostDetailed` — body lives in
    /// `dev_server::memory_cost_body` (free fn ported from `memory_cost.zig`).
    #[inline]
    pub fn memory_cost_detailed(&self) -> MemoryCost {
        crate::bake::dev_server::memory_cost_body::memory_cost_detailed(self)
    }

    /// Recover `&VirtualMachine` from the JSC_BORROW `vm` back-reference.
    /// Safe `Deref` via [`BackRef`](bun_ptr::BackRef): vm is valid for
    /// DevServer's entire lifetime (DevServer.zig:315).
    #[inline]
    pub(crate) fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    /// Safe `&'static JSGlobalObject` accessor — `self.vm().global()`.
    /// `'static` so the borrow is decoupled from `&self` and may be held
    /// across `&mut self` reborrows.
    #[inline]
    pub(crate) fn global(&self) -> &'static JSGlobalObject {
        self.vm().global()
    }

    /// Recover `&mut VirtualMachine` via the global singleton — `self.vm` is
    /// `*const`. The VM is process-unique on the JS thread, so
    /// `VirtualMachine::get()` returns the same instance with write provenance.
    /// SAFETY: single JS thread; caller must not hold an aliasing `&mut`.
    #[inline]
    pub(crate) fn vm_mut(&self) -> &mut VirtualMachine {
        debug_assert!(::core::ptr::eq(self.vm.as_ptr(), VirtualMachine::get()));
        VirtualMachine::get_mut()
    }

    // ── transpiler accessors ───────────────────────────────────────────────
    // The three transpilers are `MaybeUninit` until `init()` writes them via
    // `Framework::init_transpiler`. Every access after `init()` returns goes
    // through these helpers; the SAFETY contract is that `init()` is the only
    // constructor and it always populates all three before returning `Ok`.
    #[inline]
    pub fn server_transpiler(&self) -> &Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.server_transpiler.assume_init_ref() }
    }
    #[inline]
    pub fn server_transpiler_mut(&mut self) -> &mut Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.server_transpiler.assume_init_mut() }
    }
    #[inline]
    pub fn client_transpiler(&self) -> &Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.client_transpiler.assume_init_ref() }
    }
    #[inline]
    pub fn client_transpiler_mut(&mut self) -> &mut Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.client_transpiler.assume_init_mut() }
    }
    #[inline]
    pub fn ssr_transpiler(&self) -> &Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.ssr_transpiler.assume_init_ref() }
    }
    #[inline]
    pub fn ssr_transpiler_mut(&mut self) -> &mut Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.ssr_transpiler.assume_init_mut() }
    }
}
pub use crate::bake::dev_server::WatcherAtomics;
pub use crate::bake::dev_server::packed_map::PackedMap;
pub use crate::bake::dev_server::route_bundle::RouteBundle;
pub use crate::bake::dev_server::serialized_failure::SerializedFailure;
pub use crate::bake::dev_server::source_map_store::SourceMapStore;

bun_output::declare_scope!(DevServer, visible);
bun_output::declare_scope!(IncrementalGraph, visible);
bun_output::declare_scope!(SourceMapStore, visible);

bun_output::define_scoped_log!(debug_log, crate::bake::dev_server_body::DevServer);
bun_output::define_scoped_log!(ig_log, crate::bake::dev_server_body::IncrementalGraph);
bun_output::define_scoped_log!(map_log, crate::bake::dev_server_body::SourceMapStore);
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
    pub const DEFAULT_DUMP_SOURCES: Option<&'static [u8]> = if cfg!(debug_assertions) {
        Some(b".bake-debug")
    } else {
        None
    };
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
    /// OWNED (LIFETIMES.tsv): `BundleV2.init()` → `deinitWithoutFreeingArena()`.
    /// PORT NOTE: `'static` is a stand-in for the DevServer-self lifetime —
    /// `BundleV2<'a>` borrows the three `Transpiler<'_>` fields stored inline
    /// in `DevServer`, so the true bound is the `Box<DevServer>` allocation
    /// (stable address, never moved post-init). Threading a real `'dev` would
    /// make `DevServer` self-referential; raw-ptr aliasing inside `BundleV2`
    /// already encodes that contract.
    pub bv2: Box<BundleV2<'static>>,
    /// Information BundleV2 needs to finalize the bundle
    pub start_data: bundler::bundle_v2::DevServerInput,
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

// PORT NOTE: this is the **canonical** `DevServer` struct. `dev_server/mod.rs`
// re-exports it (`pub use super::dev_server_body::DevServer`) so the
// `container_of` submodules (`incremental_graph`, `assets`, …) and the
// 4.8 kL of method bodies in this file all name the same type. The
// `Transpiler<'static>` / `BundleV2<'static>` lifetime is the DevServer-self
// lifetime stand-in: those borrows point at fields stored inline in the
// `Box<DevServer>` allocation, which is never moved post-`init()`.
pub struct DevServer {
    /// To validate the DevServer has not been collected, this can be checked.
    /// When freed, this is set to `undefined`. UAF here also trips ASAN.
    pub magic: Magic,
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
    /// JSC_BORROW (LIFETIMES.tsv): passed in via `Options.vm`; deinit no-op.
    /// [`BackRef`](bun_ptr::BackRef) (not `&'a`) so `DevServer` is not
    /// lifetime-generic — it is `Box`-owned by `ServerInstance` which outlives
    /// the VM anyway. The back-reference invariant (pointee outlives holder)
    /// is the JSC_BORROW guarantee: vm is valid for DevServer's entire
    /// lifetime (DevServer.zig:315).
    pub vm: bun_ptr::BackRef<VirtualMachine>,
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
    pub barrel_files_with_deferrals: bun_collections::StringArrayHashMap<()>,
    /// Accumulated barrel export requests across all builds. Maps barrel file
    /// path → set of export names that have been requested. This ensures that
    /// when a barrel is re-parsed in an incremental build, exports requested
    /// by non-stale files (from previous builds) are still kept.
    pub barrel_needed_exports: bun_collections::StringArrayHashMap<StringHashMap<()>>,
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
    /// Zig: `AutoArrayHashMapUnmanaged(SerializedFailure, void,
    /// SerializedFailure.ArrayHashContextViaOwner, false)` — keyed by
    /// `failure.owner`. Port stores `OwnerPacked → SerializedFailure` so the
    /// custom context is unnecessary.
    pub bundling_failures: ArrayHashMap<serialized_failure::OwnerPacked, SerializedFailure>,
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
    // PORT NOTE: Zig stores `*bun.Watcher` and calls `deinit(true)` in
    // `DevServer.deinit`, which *transfers* ownership to the watcher thread
    // (the thread frees the allocation in `threadMain`). Auto-dropping a
    // `Box<Watcher>` here would free the heap block while the watcher thread
    // is still blocked in `GetQueuedCompletionStatus`/`read()` holding a
    // `*mut Watcher` into it (and on Windows the kernel still has a pending
    // `ReadDirectoryChangesW` against the inline `DirWatcher.buf`/`overlapped`).
    // `ManuallyDrop` so `Drop for DevServer` can hand the raw pointer to
    // `Watcher::shutdown` instead.
    pub bun_watcher: ::core::mem::ManuallyDrop<Box<Watcher>>,
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
    // Each logical graph gets its own bundler configuration.
    // PORT NOTE: `'static` is the DevServer-self lifetime stand-in (see
    // `CurrentBundle.bv2`). `Transpiler<'a>` borrows the global
    // `Fs::FileSystem` singleton + `dot_env::Loader`, both of which outlive
    // the server.
    //
    // `MaybeUninit` until `Framework::init_transpiler` populates them in place
    // (in `init()` below) — `Transpiler` contains a non-nullable `&Arena`, so
    // neither `Default` nor `mem::zeroed()` are sound (PORTING.md §Forbidden).
    pub server_transpiler: ::core::mem::MaybeUninit<Transpiler<'static>>,
    pub client_transpiler: ::core::mem::MaybeUninit<Transpiler<'static>>,
    pub ssr_transpiler: ::core::mem::MaybeUninit<Transpiler<'static>>,
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
    pub deferred_request_pool:
        HiveArrayFallback<deferred_request::Node, { DeferredRequest::MAX_PREALLOCATED }>,
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

bun_event_loop::impl_timer_owner!(DevServer; from_timer_ptr => memory_visualizer_timer);

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
        // Zig: `this.strong.deinit()` — `JSPromiseStrong` has no `deinit`; the
        // underlying `JscStrong` is released by `Drop` when overwritten.
        self.strong = jsc::JSPromiseStrong::empty();
        self.route_bundle_indices.clear_retaining_capacity();
    }

    pub fn deinit_idempotently(&mut self) {
        self.strong = jsc::JSPromiseStrong::empty();
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
                Output::warn(format_args!(
                    "Could not open directory for dumping sources: {}",
                    err
                ));
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
        w!(root, Box::from(options.root.as_bytes()));
        w!(vm, bun_ptr::BackRef::new(options.vm));
        w!(server, None);
        w!(directory_watchers, DirectoryWatchStore::default());
        w!(server_fetch_function_callback, jsc::StrongOptional::empty());
        w!(
            server_register_update_callback,
            jsc::StrongOptional::empty()
        );
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
                && options.dump_state_on_crash.unwrap_or_else(|| {
                    bun_core::env_var::feature_flag::BUN_DUMP_STATE_ON_CRASH
                        .get()
                        .unwrap_or(false)
                })
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
        w!(inspector_server_id, DebuggerId::init(0)); // TODO paper clover:
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
        w!(deferred_request_pool, HiveArrayFallback::init());

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
                pattern_string_arena: Arena::new(),
                edges: Vec::new(),
                freed_edges: Vec::new(),
            }
        );
    }

    let global = options.vm.global();

    let generic_action = "while initializing development server";
    // FileSystem is a process-lifetime singleton; `init` interns the path into
    // the `DirnameStore` (process-lifetime arena) so no caller-side leak is
    // needed for the `'static` it stores.
    let fs = match bun_resolver::fs::FileSystem::init(Some(options.root.as_bytes())) {
        Ok(fs) => fs,
        Err(err) => return Err(global.throw_error(err, generic_action)),
    };
    let top_level_dir: &'static [u8] = bun_resolver::fs::FileSystem::get().top_level_dir;

    // `.bun_watcher = undefined` → `Watcher.init(DevServer, dev, fs, ...)`
    // SAFETY: `Watcher::init` only stores `p` as an opaque `*mut ()` ctx; it does
    // not dereference it until `start()` spawns the watcher thread, by which point
    // every `DevServer` field is initialized (`assume_init` below precedes
    // `bun_watcher.start()`).
    let bun_watcher = match Watcher::init::<DevServer>(p, top_level_dir) {
        Ok(w) => w,
        Err(err) => {
            return Err(global.throw_error(
                err,
                "while initializing file watcher for development server",
            ));
        }
    };
    // SAFETY: per-field write into uninit struct; see `w!` SAFETY above.
    unsafe { w!(bun_watcher, ::core::mem::ManuallyDrop::new(bun_watcher)) };
    // errdefer dev.bun_watcher.deinit(false) — handled by `Watcher::shutdown` in
    // `Drop for DevServer` when `dev_uninit` is dropped on an error path after
    // `assume_init()`.

    // `.watcher_atomics = undefined` → `WatcherAtomics.init(dev)`
    // SAFETY: `WatcherAtomics::init` / `HotReloadEvent::init_empty` only store `p`
    // as a BACKREF for later `concurrent_task.from(dev)` / `run`; not dereferenced
    // during construction.
    unsafe { w!(watcher_atomics, WatcherAtomics::init(p)) };

    // This causes a memory leak, but the allocator is otherwise used on multiple threads.
    // (allocator param dropped — global mimalloc)

    // `.server_transpiler/.client_transpiler/.ssr_transpiler = undefined` →
    // `Framework.initTranspiler(..., &dev.X_transpiler, ...)`.
    //
    // SAFETY: `init_transpiler` writes the slot via `MaybeUninit::write` (see
    // `bake_body.rs`), so the previous (uninitialized) bytes are never dropped.
    // `framework`/`log`/`bundler_options` were written above; reborrowing each
    // individually via `addr_of_mut!` is sound because no `&mut DevServer` exists.
    // PORT NOTE: `Transpiler<'static>` erases the arena lifetime — `options.arena`
    // is the `UserOptions.arena` which is moved into / outlives the `DevServer`
    // box (Zig had no lifetime). Widen `'a → 'static` here once.
    // SAFETY: `options.arena` outlives every `Transpiler` field it backs (see
    // `Options::arena` doc — "must live until DevServer drops").
    let arena: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(options.arena) };
    unsafe {
        let framework = &mut *addr_of_mut!((*p).framework);
        let log = &mut *addr_of_mut!((*p).log);
        let bundler_options = &mut *addr_of_mut!((*p).bundler_options);

        if let Err(err) = framework.init_transpiler(
            arena,
            log,
            bake::Mode::Development,
            bake::Graph::Server,
            &mut *addr_of_mut!((*p).server_transpiler),
            &bundler_options.server,
        ) {
            return Err(global.throw_error(err, generic_action));
        }
        if let Err(err) = framework.init_transpiler(
            arena,
            log,
            bake::Mode::Development,
            bake::Graph::Client,
            &mut *addr_of_mut!((*p).client_transpiler),
            &bundler_options.client,
        ) {
            return Err(global.throw_error(err, generic_action));
        }
        if separate_ssr_graph {
            if let Err(err) = framework.init_transpiler(
                arena,
                log,
                bake::Mode::Development,
                bake::Graph::Ssr,
                &mut *addr_of_mut!((*p).ssr_transpiler),
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
    let dev_ptr: *mut DevServer = &raw mut *dev;

    // PORT NOTE: Zig asserted `*.owner() == dev` (intrusive parent-ptr derived
    // via `container_of`). The Rust port stores these by value; `owner()`
    // is provided on `IncrementalGraph` via `offset_of!` so the invariant is
    // structural. Retain the field touches so the addresses are stable for
    // `container_of` consumers below.
    let _ = (
        &dev.server_graph,
        &dev.client_graph,
        &dev.directory_watchers,
    );

    let _unlock = dev.graph_safety_lock.guard();

    if let Err(err) = dev.bun_watcher.start() {
        return Err(global.throw_error(
            err,
            "while initializing file watcher thread for development server",
        ));
    }

    // `bun_resolver::AnyResolveWatcher` is now a re-export of
    // `bun_watcher::AnyResolveWatcher` (LAYERING: same type), so the watcher's
    // vtable flows directly into the resolver without conversion.
    let resolve_watcher = dev.bun_watcher.get_resolve_watcher();
    dev.server_transpiler_mut().options.dev_server = dev_ptr as *const ();
    dev.server_transpiler_mut().resolver.watcher = Some(resolve_watcher);
    dev.client_transpiler_mut().options.dev_server = dev_ptr as *const ();
    dev.client_transpiler_mut().resolver.watcher = Some(resolve_watcher);

    if separate_ssr_graph {
        dev.ssr_transpiler_mut().options.dev_server = dev_ptr as *const ();
        dev.ssr_transpiler_mut().resolver.watcher = Some(resolve_watcher);
    }

    debug_assert!(dev.server_transpiler().resolver.opts.target != bun_ast::Target::Browser);
    debug_assert!(dev.client_transpiler().resolver.opts.target == bun_ast::Target::Browser);

    // PORT NOTE: reborrow `framework` and the two resolvers via `dev_ptr` so
    // borrowck doesn't see three overlapping `&mut dev`.
    // SAFETY: `dev_ptr` is the live `Box<DevServer>` heap address; the three
    // fields are disjoint.
    if let Err(_) = unsafe { &mut (*dev_ptr).framework }.resolve(
        unsafe { &mut (*(*dev_ptr).server_transpiler.as_mut_ptr()).resolver },
        unsafe { &mut (*(*dev_ptr).client_transpiler.as_mut_ptr()).resolver },
        options.arena,
    ) {
        if dev.framework.is_built_in_react {
            bake::Framework::add_react_install_command_note(&mut dev.log);
        }
        return Err(global.throw_value(dev.log.to_js_aggregate_error(
            global,
            BunString::static_("Framework is missing required files!"),
        )?));
    }

    // Spec DevServer.zig:425 — Zig stores `transpiler.options.framework` as a
    // `?*bake.Framework` aliasing `dev.framework`, so the post-`resolve`
    // assignment retroactively gives every transpiler the resolved
    // `server_runtime_import` / `react_fast_refresh.import_source`. The Rust
    // port arena-snapshots that projection inside `init_transpiler`, breaking
    // the alias; re-project after resolve so parser-generated imports (e.g.
    // `serverRuntimeImportSource` in `wrap_exports_for_client_reference`) see
    // absolute paths instead of the user's relative `"./framework/server.ts"`.
    {
        let resolved_view: &'static bun_bundler::bake_types::Framework =
            &*arena.alloc(dev.framework.as_bundler_view());
        dev.server_transpiler_mut().options.framework = Some(resolved_view);
        dev.client_transpiler_mut().options.framework = Some(resolved_view);
        if separate_ssr_graph {
            dev.ssr_transpiler_mut().options.framework = Some(resolved_view);
        }
    }

    // errdefer dev.route_lookup.clearAndFree() / client_graph.deinit() / server_graph.deinit()
    // — handled by Drop

    dev.configuration_hash_key = 'hash_key: {
        let mut h = Wyhash::init(128);

        if cfg!(debug_assertions) {
            // PORT NOTE: `sys::stat` returns `Maybe<Stat>` (no `unwrap_or_else`);
            // go through `Result` for the panic-on-error path.
            let stat = match ::core::result::Result::from(sys::stat(
                bun_core::self_exe_path()
                    .unwrap_or_else(|e| Output::panic(format_args!("unhandled {}", e))),
            )) {
                Ok(s) => s,
                Err(e) => Output::panic(format_args!("unhandled {}", e)),
            };
            // PORT NOTE: `sys::Stat` is `libc::stat` on POSIX / `uv_stat_t` on
            // Windows (where mtime is `mtim.sec`). Debug-only cache-bust key.
            #[cfg(not(windows))]
            bun_core::write_any_to_hasher(&mut h, &(stat.st_mtime as i64));
            #[cfg(windows)]
            bun_core::write_any_to_hasher(&mut h, &(stat.mtim.sec as i64));
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
                == incremental_graph::FileIndex::<{ bake::Side::Client }>::init(0) // Zig: react_refresh_index = .init(0)
        );
    }

    if !dev.frontend_only {
        dev.init_server_runtime();
    }

    // Initialize FrameworkRouter
    dev.router = 'router: {
        let mut types: Vec<framework_router::Type> =
            Vec::with_capacity(dev.framework.file_system_router_types.len());

        // PORT NOTE: the loop body mutates `server_transpiler.resolver`,
        // `server_graph`, `client_graph`, and `route_lookup` while iterating
        // `framework.file_system_router_types` by shared ref. All five fields
        // are disjoint; reborrow them through `dev_ptr` so the shared
        // `framework` iter does not lock `*dev`.
        for (i, fsr) in unsafe { &(*dev_ptr).framework }
            .file_system_router_types
            .iter()
            .enumerate()
        {
            let mut buf = paths::path_buffer_pool::get();
            let joined_root = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
                &dev.root,
                &mut buf[..],
                &[&fsr.root],
            );
            // SAFETY: `server_transpiler` was fully initialized by `init_transpiler`
            // above; `.resolver` is disjoint from `framework`.
            let Some(entry) = unsafe { (*dev_ptr).server_transpiler.assume_init_mut() }
                .resolver
                .read_dir_info_ignore_error(joined_root)
            else {
                continue;
            };

            // SAFETY: `server_graph` is disjoint from `framework`.
            let server_file = unsafe { &mut (*dev_ptr).server_graph }.insert_stale_extra(
                &fsr.entry_server,
                false,
                true,
            )?;

            types.push(framework_router::Type {
                abs_root: strings::without_trailing_slash(entry.abs_path).into(),
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
                style: fsr.style.clone(),
                allow_layouts: fsr.allow_layouts,
                server_file: to_opaque_file_id::<{ bake::Side::Server }>(server_file),
                client_file: if let Some(client) = &fsr.entry_client {
                    Some(to_opaque_file_id::<{ bake::Side::Client }>(
                        // SAFETY: `client_graph` is disjoint from `framework`.
                        unsafe { &mut (*dev_ptr).client_graph }.insert_stale(client, false)?,
                    ))
                } else {
                    None
                },
                server_file_string: jsc::StrongOptional::empty(),
            });

            // SAFETY: `route_lookup` is disjoint from `framework`.
            unsafe { &mut (*dev_ptr).route_lookup }.put(
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

    #[cfg(feature = "bake_debugging_features")]
    if dev.has_pre_crash_handler {
        bun_crash_handler::append_pre_crash_handler::<DevServer>(
            &mut *dev,
            dump_state_due_to_crash,
        )?;
    }

    debug_assert!(dev.magic == Magic::Valid);

    Ok(dev)
}

impl Drop for DevServer {
    fn drop(&mut self) {
        debug_log!("deinit");
        // Zig used `+|= 1` (saturating add); for a usize test counter, wrapping
        // at usize::MAX is unreachable in practice, so a plain fetch_add is fine.
        DEV_SERVER_DEINIT_COUNT_FOR_TESTING.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

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
                let sockets: Vec<*mut HmrSocket> =
                    self.active_websocket_connections.keys().copied().collect();
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
            let timer_ptr: *mut EventLoopTimer = &raw mut self.memory_visualizer_timer;
            self.timer_heap().remove(timer_ptr);
        }
        self.graph_safety_lock.lock();
        // Zig: `.bun_watcher = dev.bun_watcher.deinit(true),` — hand ownership of
        // the heap allocation to the watcher thread (which frees it in
        // `thread_main` once `running` flips false). Auto-dropping the `Box`
        // here would free the allocation out from under the still-running
        // thread; on Windows the kernel additionally retains a pending
        // `ReadDirectoryChangesW` against the inline 64 KiB `DirWatcher.buf` +
        // `overlapped`, so the freed block being recycled by mimalloc for a
        // later allocation is a kernel write into live unrelated heap data.
        // SAFETY: `bun_watcher` was written exactly once in `init()` and is
        // never taken elsewhere; this is `Drop`, so the field is not read again.
        let watcher = unsafe { ::core::mem::ManuallyDrop::take(&mut self.bun_watcher) };
        Watcher::shutdown(Box::into_raw(watcher), true);

        #[cfg(feature = "bake_debugging_features")]
        if let Some(dir) = self.dump_dir.take() {
            drop(dir);
        }

        if self.has_pre_crash_handler {
            bun_crash_handler::remove_pre_crash_handler(std::ptr::from_mut(self).cast::<c_void>());
        }

        // PORT NOTE: Zig looped `failure.deinit()` then `clearAndFree`. The
        // map's `Drop` runs `SerializedFailure::drop` for each value, so the
        // explicit loop is folded into field drop.

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
            // PORT NOTE: `Entry`'s owned buffers are freed by `Drop` when the
            // map drops; Zig's explicit `deinit` was the allocator-free.
        }
        if self.source_maps.weak_ref_sweep_timer.state == EventLoopTimerState::ACTIVE {
            let timer_ptr: *mut EventLoopTimer = &raw mut self.source_maps.weak_ref_sweep_timer;
            self.timer_heap().remove(timer_ptr);
        }

        for event in &mut self.watcher_atomics.events {
            event.dirs.clear_and_free();
            event.files.clear_and_free();
            event.extra_files.clear();
        }

        if let TestingBatchEvents::Enabled(batch) = &mut self.testing_batch_events {
            drop(std::mem::replace(
                &mut batch.entry_points,
                EntryPointList::empty(),
            ));
        }

        debug_assert!(self.magic == Magic::Valid);
        // self.magic = undefined — no Rust equivalent; freed memory.
    }
}

impl DevServer {
    /// Zig threaded a borrowed debug allocator handle through DevServer; in
    /// the Rust port everything is `Box`/`Vec` on the global mimalloc, so this
    /// just returns the default `StdAllocator`. Kept for the few call sites
    /// that still want a `StdAllocator` handle.
    #[inline]
    pub fn allocator(&self) -> bun_alloc::StdAllocator {
        bun_alloc::StdAllocator::default()
    }
}

// re-exports from memory_cost module already declared at top

impl DevServer {
    fn init_server_runtime(&mut self) {
        let runtime = BunString::static_(
            crate::bake::bake_body::get_hmr_runtime(crate::bake::bake_body::Side::Server).code,
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
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime;
                // `print_error_like_object_to_console` needs `&mut VM`, so cast
                // the shared borrow through a raw pointer (single-threaded JS).
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
    fn scan_initial_routes(&mut self) -> Result<(), bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — Zig passed `dev` as the
        // `InsertionContext` while also borrowing `&mut dev.router` and
        // `&mut dev.server_transpiler.resolver`. Reborrow each via the raw
        // self-ptr (the three are disjoint fields of the heap-stable `*self`).
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // SAFETY: `router`, `server_transpiler.resolver`, and the
        // `InsertionHandler` callbacks (touch `server_graph`/`route_lookup`)
        // are disjoint fields of `*self_ptr`.
        unsafe {
            (*self_ptr).router.scan_all(
                &mut (*(*self_ptr).server_transpiler.as_mut_ptr()).resolver,
                framework_router::InsertionContext::wrap(&mut *self_ptr),
            )?;
        }

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
        let app = unsafe { &mut *server.app.unwrap() };
        let dev = std::ptr::from_mut::<Self>(self).cast::<c_void>();

        // PORT NOTE: Zig's `wrapGenericRequestHandler(fn, is_ssl)` produced a
        // monomorphized `extern fn(*DevServer, *Response, *Request)` per
        // handler. The Rust equivalent is the ZST-fn-item trampoline pattern
        // used by `server::server_body::AppRouteExt`: a generic `extern "C"`
        // shim parameterized on the handler type `H` (which is zero-sized for
        // a fn-item), so each `tramp::<H, SSL>` lowers to a distinct C
        // function pointer with the handler baked in.
        macro_rules! route {
            ($method:ident, $pattern:expr, $id:expr) => {{
                app.$method($pattern, Some(dev_route_tramp::<SSL, { $id }>), dev);
            }};
        }

        route!(
            get,
            const_format::concatcp!(CLIENT_PREFIX, "/:route").as_bytes(),
            DevHandlerId::JsRequest
        );
        route!(
            get,
            const_format::concatcp!(ASSET_PREFIX, "/:asset").as_bytes(),
            DevHandlerId::AssetRequest
        );
        route!(
            get,
            const_format::concatcp!(INTERNAL_PREFIX, "/src/*").as_bytes(),
            DevHandlerId::SrcRequest
        );
        route!(
            post,
            const_format::concatcp!(INTERNAL_PREFIX, "/report_error").as_bytes(),
            DevHandlerId::ReportError
        );
        route!(
            post,
            const_format::concatcp!(INTERNAL_PREFIX, "/unref").as_bytes(),
            DevHandlerId::UnrefSourceMap
        );
        route!(any, INTERNAL_PREFIX.as_bytes(), DevHandlerId::NotFound);

        app.ws(
            const_format::concatcp!(INTERNAL_PREFIX, "/hmr").as_bytes(),
            dev,
            0,
            hmr_socket_behavior::<SSL>(),
        );

        #[cfg(feature = "bake_debugging_features")]
        {
            route!(
                get,
                const_format::concatcp!(INTERNAL_PREFIX, "/incremental_visualizer").as_bytes(),
                DevHandlerId::IncrementalVisualizer
            );
            route!(
                get,
                const_format::concatcp!(INTERNAL_PREFIX, "/memory_visualizer").as_bytes(),
                DevHandlerId::MemoryVisualizer
            );
        }

        // Only attach a catch-all handler if the framework has filesystem
        // router types. Otherwise, this can just be Bun.serve's default handler.
        if !self.framework.file_system_router_types.is_empty() {
            route!(any, b"/*", DevHandlerId::Request);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

/// Handler dispatch for `dev_route_tramp`. Zig used a comptime fn-ptr param to
/// monomorphize one `extern "C"` trampoline per handler; Rust can't take a fn
/// pointer as a const generic, so use a `ConstParamTy` enum instead and
/// `match` inside the trampoline (the optimizer folds the constant `match`).
#[derive(Copy, Clone, Eq, PartialEq, ::core::marker::ConstParamTy)]
pub enum DevHandlerId {
    JsRequest,
    AssetRequest,
    SrcRequest,
    ReportError,
    UnrefSourceMap,
    NotFound,
    Request,
    IncrementalVisualizer,
    MemoryVisualizer,
}

/// `extern "C"` trampoline: recovers `&mut DevServer` from user-data and wraps
/// the raw `uws_res` as `AnyResponse`, then calls the handler for `ID`.
extern "C" fn dev_route_tramp<const SSL: bool, const ID: DevHandlerId>(
    res: *mut bun_uws_sys::uws_res,
    req: *mut bun_uws_sys::Request,
    ud: *mut c_void,
) {
    // SAFETY: `ud`/`req`/`res` were registered by `set_routes` and outlive the
    // route; uWS guarantees they are non-null in handler callbacks.
    let dev = unsafe { bun_ptr::callback_ctx::<DevServer>(ud) };
    let req = unsafe { &mut *req.cast::<Request>() };
    let resp = if SSL {
        AnyResponse::SSL(res.cast::<bun_uws_sys::response::TLSResponse>())
    } else {
        AnyResponse::TCP(res.cast::<bun_uws_sys::response::TCPResponse>())
    };
    match ID {
        DevHandlerId::JsRequest => on_js_request(dev, req, resp),
        DevHandlerId::AssetRequest => on_asset_request(dev, req, resp),
        DevHandlerId::SrcRequest => on_src_request(dev, req, resp),
        DevHandlerId::ReportError => on_report_error_request(dev, req, resp),
        DevHandlerId::UnrefSourceMap => on_unref_source_map_request(dev, req, resp),
        DevHandlerId::NotFound => on_not_found(dev, req, resp),
        DevHandlerId::Request => on_request(dev, req, resp),
        #[cfg(feature = "bake_debugging_features")]
        DevHandlerId::IncrementalVisualizer => on_incremental_visualizer(dev, req, resp),
        #[cfg(feature = "bake_debugging_features")]
        DevHandlerId::MemoryVisualizer => on_memory_visualizer(dev, req, resp),
        #[cfg(not(feature = "bake_debugging_features"))]
        DevHandlerId::IncrementalVisualizer | DevHandlerId::MemoryVisualizer => not_found(resp),
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
        AnyResponse::H3(_) => not_found(resp),
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
        AnyResponse::H3(_) => not_found(resp),
    }
}

/// `WebSocketBehavior.Wrap(DevServer, HmrSocket, ssl).apply(.{})`.
fn hmr_socket_behavior<const SSL: bool>() -> bun_uws_sys::WebSocketBehavior {
    bun_uws_sys::web_socket::Wrap::<DevServer, HmrSocket, SSL>::apply(Default::default())
}

// `WebSocketBehavior.Wrap(ServerType, Type, ssl)` requires `Type` (= `HmrSocket`)
// to be a `WebSocketHandler` and `ServerType` (= `DevServer`) to be a
// `WebSocketUpgradeServer<SSL>`. The Zig used `@hasDecl` duck-typing; in Rust
// we wire the trait explicitly and forward to the inherent method bodies in
// `dev_server::hmr_socket_body`.
impl bun_uws_sys::web_socket::WebSocketHandler for HmrSocket {
    // Zig HmrSocket has no `onDrain`/`onPing`/`onPong` decls — `Wrap.apply`
    // leaves those C callbacks `null` when `HAS_ON_* == false`.
    const HAS_ON_DRAIN: bool = false;
    const HAS_ON_PING: bool = false;
    const HAS_ON_PONG: bool = false;

    // PORT NOTE (noalias re-entrancy): the trait now hands the handler a raw
    // `*mut Self` (see `WebSocketHandler` doc). `HmrSocket::on_close` already
    // takes `*mut Self`; `on_open`/`on_message` still take `&mut self` so
    // re-derive a fresh `&mut *this` here (not carried in from a `noalias`
    // dispatch-frame borrow).
    #[inline]
    unsafe fn on_open(this: *mut Self, ws: bun_uws_sys::AnyWebSocket) {
        // SAFETY: `this` is the live user-data pointer (per trait contract).
        HmrSocket::on_open(unsafe { &mut *this }, ws)
    }
    #[inline]
    unsafe fn on_message(
        this: *mut Self,
        ws: bun_uws_sys::AnyWebSocket,
        message: &[u8],
        opcode: bun_uws_sys::Opcode,
    ) {
        // SAFETY: see `on_open`.
        HmrSocket::on_message(unsafe { &mut *this }, ws, message, opcode)
    }
    #[inline]
    unsafe fn on_close(this: *mut Self, ws: bun_uws_sys::AnyWebSocket, code: i32, message: &[u8]) {
        // SAFETY: see `on_open`.
        unsafe { HmrSocket::on_close(this, ws, code, message) }
    }
    unsafe fn on_drain(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket) {}
    unsafe fn on_ping(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket, _message: &[u8]) {}
    unsafe fn on_pong(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket, _message: &[u8]) {}
}

impl<const SSL: bool> bun_uws_sys::web_socket::WebSocketUpgradeServer<SSL> for DevServer {
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
        res: *mut bun_uws_sys::NewAppResponse<SSL>,
        req: &mut Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        debug_assert_eq!(id, 0);
        // SAFETY: DevServer always registers `*mut Self` with `id == 0`
        // (`set_routes` → `app.ws(prefix, this, 0, ..)`); live for the upgrade
        // callback's duration.
        let this = unsafe { &mut *this };
        // SAFETY: uWS guarantees `res` is non-null and live for the upgrade
        // callback; `Response<SSL>` is an opaque handle.
        let res = unsafe { &mut *res };
        let dw = bun_core::heap::into_raw(HmrSocket::new(this, res));
        let _ = this.active_websocket_connections.insert(dw, ());
        let _ = res.upgrade(
            dw,
            req.header(b"sec-websocket-key").unwrap_or(b""),
            req.header(b"sec-websocket-protocol").unwrap_or(b""),
            req.header(b"sec-websocket-extension").unwrap_or(b""),
            Some(upgrade_ctx),
        );
    }
}

// `ResponseLike` for the concrete `Response<SSL>` so `HmrSocket::new` can be
// called from `on_websocket_upgrade` (Zig: `res: anytype`).
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
    fn get_remote_socket_info(&mut self) -> Option<bun_uws::SocketAddress> {
        bun_uws_sys::response::Response::<SSL>::get_remote_socket_info(self).map(|a| {
            bun_uws::SocketAddress {
                ip: a.ip.to_vec().into_boxed_slice(),
                port: a.port,
                is_ipv6: a.is_ipv6,
            }
        })
    }
    fn upgrade<D>(
        &mut self,
        data: D,
        sec_web_socket_key: &[u8],
        sec_web_socket_protocol: &[u8],
        sec_web_socket_extensions: &[u8],
        ctx: &mut bun_uws::WebSocketUpgradeContext,
    ) {
        let boxed = bun_core::heap::into_raw(Box::new(data));
        let _ = bun_uws_sys::response::Response::<SSL>::upgrade(
            self,
            boxed,
            sec_web_socket_key,
            sec_web_socket_protocol,
            sec_web_socket_extensions,
            Some(ctx),
        );
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
        // PORT NOTE: `render_json` needs `&mut DevServer` while `entry` borrows
        // `dev.source_maps.entries[_]`. The entry is read-only (`&self`) and
        // `render_json` does not touch `source_maps.entries`, so erase the
        // entry borrow to a raw pointer and reborrow `dev` for the call.
        let Some(entry) = dev
            .source_maps
            .entries
            .get_mut(&source_map_store::Key::init(id))
        else {
            return not_found(resp);
        };
        let entry_ptr: *const source_map_store::Entry = &raw const *entry;
        // PERF(port): was ArenaAllocator scratch
        // SAFETY: `entry_ptr` points into `dev.source_maps.entries` storage,
        // which is not reallocated by `render_json`.
        let json_bytes =
            match unsafe { &*entry_ptr }.render_json(dev, source_id.kind(), bake::Side::Client) {
                Ok(b) => b,
                Err(e) => bun_core::handle_oom(Err(e)),
            };
        let response = StaticRoute::init_from_any_blob(
            crate::webcore::blob::Any::from_array_list(json_bytes),
            crate::server::static_route::InitFromBytesOptions {
                server: dev.server,
                mime_type: Some(&MimeType::JSON),
                ..Default::default()
            },
        );
        // SAFETY: `init_from_any_blob` returns a fresh ref_count=1 box.
        scopeguard::defer! { unsafe { StaticRoute::deref_(response) } };
        // SAFETY: `response` is live until `_deref` runs after this returns.
        unsafe { StaticRoute::on_request(response, bun_uws::AnyRequest::H1(req), resp) };
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
    // SAFETY: asset is a live `*mut StaticRoute` held by the content-addressable store
    unsafe { StaticRoute::on(asset, resp) };
}

pub use bun_core::fmt::parse_hex_to_int;

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
    // This is already done in Next.js. we have to port this to Zig so we can use.
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
            AnyResponse::init(resp.cast::<bun_uws_sys::response::Response<true>>())
        } else {
            AnyResponse::init(resp.cast::<bun_uws_sys::response::Response<false>>())
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
    let code = bun_core::runtime_embed_file!(SrcEager, "runtime/bake/incremental_visualizer.html")
        .as_bytes();
    resp.end(code, false);
}

fn on_memory_visualizer(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    resp.corked(move || on_memory_visualizer_corked(resp));
}

fn on_memory_visualizer_corked(resp: AnyResponse) {
    let code =
        bun_core::runtime_embed_file!(SrcEager, "runtime/bake/memory_visualizer.html").as_bytes();
    resp.end(code, false);
}

struct RequestEnsureRouteBundledCtx {
    // PORT NOTE: erased to raw pointer — the Zig code freely re-borrowed `dev`
    // across the ctx; a `&mut DevServer` field would alias the caller's borrow.
    dev: *mut DevServer,
    req: ReqOrSaved,
    resp: AnyResponse,
    kind: deferred_request::HandlerKind,
    route_bundle_index: route_bundle::Index,
}

impl RequestEnsureRouteBundledCtx {
    /// Reborrow the erased `dev` pointer.
    /// # Safety
    /// `self.dev` is set from a live `&mut DevServer` at ctx construction and
    /// outlives the ctx (the ctx is stack-local in the request handler scope).
    #[inline]
    fn dev_mut(&mut self) -> &mut DevServer {
        unsafe { &mut *self.dev }
    }

    fn on_defer(&mut self, bundle_field: BundleQueueType) -> JsResult<()> {
        // PORT NOTE: reshaped for borrowck — captured args before re-borrowing dev
        let route_bundle_index = self.route_bundle_index;
        let kind = self.kind;
        let req = ::core::mem::replace(&mut self.req, ReqOrSaved::Aborted); // TODO(port): ReqOrSaved moved into deferRequest
        let resp = self.resp;
        let dev = self.dev_mut();
        let requests_array: *mut deferred_request::List = match bundle_field {
            BundleQueueType::CurrentBundle => {
                &raw mut dev
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active")
                    .requests
            }
            BundleQueueType::NextBundle => &raw mut dev.next_bundle.requests,
        };
        // SAFETY: requests_array points into self.dev which is still valid
        self.dev_mut().defer_request(
            unsafe { &mut *requests_array },
            route_bundle_index,
            kind,
            req,
            resp,
        )?;
        Ok(())
    }

    fn on_loaded(&mut self) -> JsResult<()> {
        match self.kind {
            deferred_request::HandlerKind::ServerHandler => {
                let route_bundle_index = self.route_bundle_index;
                let resp = self.resp;
                // PORT NOTE: Zig copied `SavedRequest` by value (POD); Rust's
                // `Strong` field is move-only. Take ownership out of `self.req`
                // (it is consumed by `on_framework_request_with_bundle`).
                let req = match ::core::mem::replace(&mut self.req, ReqOrSaved::Aborted) {
                    ReqOrSaved::Req(r) => SavedRequestUnion::Stack(unsafe { &mut *r }),
                    ReqOrSaved::Saved(s) => SavedRequestUnion::Saved(s),
                    ReqOrSaved::Aborted => unreachable!(),
                };
                self.dev_mut()
                    .on_framework_request_with_bundle(route_bundle_index, req, resp)
            }
            deferred_request::HandlerKind::BundledHtmlPage => {
                let route_bundle_index = self.route_bundle_index;
                let resp = self.resp;
                let method = self.req.method();
                self.dev_mut()
                    .on_html_request_with_bundle(route_bundle_index, resp, method);
                Ok(())
            }
        }
    }

    fn on_failure(&mut self) -> JsResult<()> {
        // PORT NOTE: Zig held two `*DevServer`-derived borrows at once
        // (route_bundle slot + send_serialized_failures). Reborrow via raw
        // pointer so the failure slice and the `&mut DevServer` don't alias.
        let route_bundle_index = self.route_bundle_index;
        let failure = std::ptr::from_ref::<SerializedFailure>(
            self.dev_mut()
                .route_bundle_ptr(route_bundle_index)
                .data
                .framework()
                .evaluate_failure
                .as_ref()
                .unwrap(),
        );
        // SAFETY: `failure` points into `route_bundles[i].data` which is not
        // mutated by `send_serialized_failures`.
        let failures = ::core::slice::from_ref(unsafe { &*failure });
        let resp = self.resp;
        self.dev_mut().send_serialized_failures(
            DevResponse::Http(resp),
            failures,
            ErrorPageKind::Evaluation,
            None,
        )?;
        Ok(())
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        self.resp.end(b"Plugin Error", false);
        Ok(())
    }

    fn to_dev_response(&mut self) -> DevResponse<'_> {
        DevResponse::Http(self.resp)
    }
}

impl EnsureRouteCtx for RequestEnsureRouteBundledCtx {
    fn on_defer(&mut self, b: BundleQueueType) -> JsResult<()> {
        Self::on_defer(self, b)
    }
    fn on_loaded(&mut self) -> JsResult<()> {
        Self::on_loaded(self)
    }
    fn on_failure(&mut self) -> JsResult<()> {
        Self::on_failure(self)
    }
    fn on_plugin_error(&mut self) -> JsResult<()> {
        Self::on_plugin_error(self)
    }
    fn to_dev_response(&mut self) -> DevResponse<'_> {
        Self::to_dev_response(self)
    }
    fn dev(&mut self) -> &mut DevServer {
        self.dev_mut()
    }
    fn route_bundle_index(&self) -> route_bundle::Index {
        self.route_bundle_index
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
    fn to_dev_response(&mut self) -> DevResponse<'_>;
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
                                // `vm()` is the centralized JSC_BORROW accessor (one
                                // `unsafe` site for the field); the borrow is dropped
                                // before the assignment so no overlap with `&mut dev`.
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

                                let load_result: crate::server::GetOrStartLoadResult = dev
                                    .server
                                    .as_ref()
                                    .expect("infallible: server bound")
                                    .get_or_load_plugins(
                                        crate::server::ServePluginsCallback::DevServer(dev),
                                    );
                                match load_result {
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
                                        dev.bundler_options.plugin =
                                            ready.map(::core::ptr::NonNull::from);
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
                dev.route_bundle_ptr(route_bundle_index).server_state =
                    route_bundle::State::Bundling;

                dev.start_async_bundle(
                    entry_points,
                    false,
                    Instant::now(), // TODO(port): std.time.Timer.start()
                )
                .expect("oom");
                return Ok(());
            }
            route_bundle::State::DeferredToNextBundle => {
                debug_assert!(
                    dev.next_bundle
                        .route_queue
                        .get(&route_bundle_index)
                        .is_some()
                );
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
            ReqOrSaved::Req(req) => {
                Method::which(unsafe { &**req }.method()).unwrap_or(Method::POST)
            }
            ReqOrSaved::Saved(saved) => unsafe { (*saved.request).method },
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
        let deferred_ptr = self.deferred_request_pool.get();
        // SAFETY: HiveArrayFallback::get returns an exclusively-owned, live node ptr
        // (heap-allocates on overflow; never null).
        let deferred = unsafe { &mut *deferred_ptr };
        // Precompute the data slot pointer (used inside the initializer for
        // abort-callback registration) before borrowing `deferred.data` for `.write()`.
        let deferred_data_ptr: *mut c_void = deferred.data.as_mut_ptr().cast::<c_void>();
        debug_log!("DeferredRequest(0x{:x}).init", deferred_data_ptr as usize);

        let method = match &req {
            // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
            ReqOrSaved::Req(r) => Method::which(unsafe { &**r }.method()).unwrap_or(Method::GET),
            ReqOrSaved::Saved(saved) => unsafe { (*saved.request).method },
            _ => unreachable!(),
        };

        deferred.data.write(DeferredRequest {
            route_bundle_index,
            dev: std::ptr::from_ref(self),
            referenced_by_devserver: true,
            weakly_referenced_by_requestcontext: false,
            handler: match kind {
                deferred_request::HandlerKind::BundledHtmlPage => 'brk: {
                    // PORT NOTE: `on_aborted<U: 'static>` rejects `DeferredRequest`;
                    // erase to `c_void` and cast back inside the trampoline.
                    resp.on_aborted(
                        |p: *mut c_void, r: AnyResponse| {
                            // SAFETY: p is the &mut deferred.data registered below; lifetime erased
                            unsafe { &mut *p.cast::<DeferredRequest>() }.on_abort(r)
                        },
                        deferred_data_ptr,
                    );
                    break 'brk Handler::BundledHtmlPage(ResponseAndMethod {
                        response: resp,
                        method,
                    });
                }
                deferred_request::HandlerKind::ServerHandler => 'brk: {
                    let server_handler: SavedRequest = match req {
                        ReqOrSaved::Req(r) => {
                            let global = self.vm().global();
                            match self
                                .server
                                .as_ref()
                                .unwrap()
                                .prepare_and_save_js_request_context(
                                    // SAFETY: r is the live µWS request for this handler frame.
                                    unsafe { &mut *r },
                                    resp,
                                    global,
                                    Some(method),
                                )? {
                                Some(saved) => saved,
                                // Zig: `catch return` — abort the deferral on failure.
                                None => {
                                    // SAFETY: `deferred_ptr` is a hive slot from
                                    // `get()` above; `deferred.data.write()` has
                                    // not run on this branch (we're still inside
                                    // the struct-literal initializer), so the slot
                                    // does not satisfy `put()`'s "fully-initialized
                                    // T" contract. `put_raw` recycles/frees without
                                    // `drop_in_place`, matching Zig's `pool.put`
                                    // (no destructor).
                                    unsafe { self.deferred_request_pool.put_raw(deferred_ptr) };
                                    return Ok(());
                                }
                            }
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
                            data: unsafe { ::core::ptr::NonNull::new_unchecked(deferred_data_ptr) },
                            deref_fn: {
                                fn deref_fn(ptr: *mut c_void) {
                                    // SAFETY: ptr is &mut DeferredRequest from above
                                    let self_: &mut DeferredRequest =
                                        unsafe { &mut *ptr.cast::<DeferredRequest>() };
                                    self_.weak_deref();
                                }
                                deref_fn
                            },
                        },
                    ));
                    break 'brk Handler::ServerHandler(server_handler);
                }
            },
        });

        // SAFETY: `deferred.data` was just initialized above.
        let deferred_data = unsafe { deferred.data.assume_init_mut() };
        if matches!(deferred_data.handler, Handler::ServerHandler(_)) {
            deferred_data.weak_ref();
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
    // PORT NOTE: erase to a raw pointer so the deferred cleanup only fires on
    // scope exit when no other borrow of `dev` is live (Zig `defer` had no
    // aliasing check).
    let dev_ptr = std::ptr::from_mut::<DevServer>(dev);
    scopeguard::defer! {
        // SAFETY: see PORT NOTE above.
        unsafe { (*dev_ptr).incremental_result.failures_added.clear() }
    };
    let _lock_guard = dev.graph_safety_lock.guard();
    let route_bundle = std::ptr::from_mut::<RouteBundle>(dev.route_bundle_ptr(route_bundle_index));
    // SAFETY: `trace_all_route_imports` reads `route_bundle.data` but never
    // mutates `route_bundles`; the raw-pointer reborrow sidesteps the
    // overlapping `&mut self`.
    dev.trace_all_route_imports(
        unsafe { &*route_bundle },
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

        // SAFETY: `send_serialized_failures` does not mutate
        // `incremental_result.failures_added`; reborrow through raw ptr to
        // satisfy borrowck.
        let failures = unsafe { &(*dev_ptr).incremental_result.failures_added };
        dev.send_serialized_failures(resp, failures, ErrorPageKind::Bundler, None)?;
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
    ) -> Result<(), bun_core::Error> {
        let server_file_names = self.server_graph.bundled_files.keys();
        let client_file_names = self.client_graph.bundled_files.keys();

        // Build a list of all files that have not yet been bundled.
        // PORT NOTE: split borrow — `route_bundle_ptr`/`type_ptr` are `&mut self`;
        // index `route_bundles`/`types` immutably so the SoA key slices above stay live.
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
                // SAFETY: html_bundle is a live *mut HTMLBundleRoute (held strong by route_bundle::Html)
                let bundle_path = unsafe { &(&(*html.html_bundle).bundle).path };
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
    /// PORT NOTE: raw-pointer receiver. Zig freely held aliasing `*DevServer` /
    /// `*RouteBundle` / `*Router.Type` heap pointers across this body; the
    /// previous Rust port bound long-lived `&mut RouteBundle` / `&mut Type` from
    /// `&mut *self_ptr` and then reborrowed `&mut *self_ptr` again — overlapping
    /// `&mut` UB. Per docs/PORTING.md §Global mutable state we instead stay in
    /// raw-ptr land: hold `*mut Self` / `*mut Type` and deref per-access via
    /// place projection (`(*this).field`), never materializing a whole-struct
    /// `&mut DevServer` while a sub-borrow is live.
    ///
    /// SAFETY: `this` must point to a live `DevServer`; `framework_bundle` must
    /// point into `(*this).route_bundles[route_bundle_index].data`. Neither
    /// `route_bundles` nor `router.types` is reallocated during this call.
    unsafe fn compute_arguments_for_framework_request(
        this: *mut Self,
        route_bundle_index: route_bundle::Index,
        framework_bundle: &mut route_bundle::Framework,
        params_js_value: JSValue,
        first_request: bool,
    ) -> JsResult<FrameworkRequestArgs> {
        // SAFETY: `this` is live; `vm` is a `BackRef` (safe Deref); `vm.global`
        // is valid for VM lifetime.
        let global = unsafe { &*(&(*this).vm).global };
        // SAFETY: place projections off `*this` — `router` / `server_graph` /
        // `route_bundles` are disjoint fields; each reborrow is scoped to its
        // expression so no two `&mut` overlap. `framework_bundle` lives in
        // `route_bundles[_].data`, disjoint from every other field touched here.
        let route_type_idx = unsafe {
            (*this)
                .router
                .route_ptr(framework_bundle.route_index)
                .r#type
        };
        // Held raw; deref per-access. `router.types` is a `Box<[Type]>` — never
        // reallocated for the lifetime of `DevServer`.
        let router_type: *mut framework_router::Type =
            unsafe { (*this).router.type_ptr(route_type_idx) };
        // Scalar copy — `route_bundles[i]` is otherwise only read (via
        // `generate_css_js_array`, which now takes `&RouteBundle`).
        let client_script_generation: u32 = unsafe {
            (&(*this).route_bundles)[route_bundle_index.get() as usize].client_script_generation
        };

        Ok(FrameworkRequestArgs {
            // routerTypeMain
            router_type_main: match unsafe { (*router_type).server_file_string.get() } {
                Some(s) => s,
                None => 'str: {
                    // SAFETY: `server_graph` is disjoint from `router` / `route_bundles`.
                    let name = unsafe {
                        &(*this).server_graph.bundled_files.keys()[from_opaque_file_id::<
                            { bake::Side::Server },
                        >(
                            (*router_type).server_file
                        )
                        .get()
                            as usize]
                    };
                    let mut buf = paths::path_buffer_pool::get();
                    let s = bun_jsc::bun_string_jsc::create_utf8_for_js(
                        global,
                        // SAFETY: `relative_path(&self)` only reads `self.root`;
                        // no `&mut` derived from `*this` is live across this call.
                        unsafe { (*this).relative_path(&mut *buf, name) },
                    )?;
                    // SAFETY: per-access raw deref; `router.types` not reallocated.
                    unsafe {
                        (*router_type).server_file_string = jsc::StrongOptional::create(s, global)
                    };
                    break 'str s;
                }
            },
            // routeModules
            route_modules: match framework_bundle.cached_module_list.get() {
                Some(a) => a,
                None => 'arr: {
                    // SAFETY: `server_graph` / `router` are disjoint from
                    // `route_bundles`; `route` is a `&Route` reborrowed per step.
                    let keys = unsafe { (*this).server_graph.bundled_files.keys() };
                    let mut n: usize = 1;
                    let mut route =
                        unsafe { (*this).router.route_ptr(framework_bundle.route_index) };
                    loop {
                        if route.file_layout.is_some() {
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = unsafe { (*this).router.route_ptr(p) };
                    }
                    let arr = JSValue::create_empty_array(global, n)?;
                    route = unsafe { (*this).router.route_ptr(framework_bundle.route_index) };
                    {
                        let mut buf = paths::path_buffer_pool::get();
                        let mut route_name = BunString::clone_utf8(unsafe {
                            (*this).relative_path(
                                &mut *buf,
                                &keys[from_opaque_file_id::<{ bake::Side::Server }>(
                                    route.file_page.unwrap(),
                                )
                                .get() as usize],
                            )
                        });
                        arr.put_index(global, 0, route_name.transfer_to_js(global)?)?;
                    }
                    n = 1;
                    loop {
                        if let Some(layout) = route.file_layout {
                            let mut buf = paths::path_buffer_pool::get();
                            let mut layout_name = BunString::clone_utf8(unsafe {
                                (*this).relative_path(
                                    &mut *buf,
                                    &keys[from_opaque_file_id::<{ bake::Side::Server }>(layout)
                                        .get() as usize],
                                )
                            });
                            arr.put_index(
                                global,
                                u32::try_from(n).expect("int cast"),
                                layout_name.transfer_to_js(global)?,
                            )?;
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = unsafe { (*this).router.route_ptr(p) };
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
                    let generation: u32 = client_script_generation;
                    // Zig: `"{x}{x}", .{ asBytes(&u32), asBytes(&u32) }` → fixed
                    // 8-char native-endian byte hex per u32; `on_js_request`
                    // slices exactly 16 chars and decodes via `parse_hex_to_int`.
                    let mut hex = [0u8; 16];
                    bun_core::fmt::bytes_to_hex_lower(&bundle_index.to_ne_bytes(), &mut hex[..8]);
                    bun_core::fmt::bytes_to_hex_lower(&generation.to_ne_bytes(), &mut hex[8..]);
                    // SAFETY: `bytes_to_hex_lower` writes ASCII [0-9a-f] only.
                    let hex_str = unsafe { ::core::str::from_utf8_unchecked(&hex) };
                    let s = OwnedString::new(BunString::create_format(format_args!(
                        "{CLIENT_PREFIX}/route-{hex_str}.js",
                    )));
                    let js = s.to_js(global)?;
                    framework_bundle.cached_client_bundle_url =
                        jsc::StrongOptional::create(js, global);
                    break 'str js;
                }
            },
            // styles
            styles: match framework_bundle.cached_css_file_array.get() {
                Some(a) => a,
                None => 'arr: {
                    // SAFETY: `generate_css_js_array` reads `client_graph` /
                    // `router` and the `&RouteBundle`; it never reallocates
                    // `route_bundles`. The `&mut *this` whole-struct reborrow
                    // here is the *only* one in this fn — no other `&`/`&mut`
                    // derived from `*this` is live across it (`router_type` /
                    // `keys` / `route` were all consumed in earlier arms).
                    let js = unsafe {
                        (*this).generate_css_js_array(
                            &(&(*this).route_bundles)[route_bundle_index.get() as usize],
                        )
                    }?;
                    framework_bundle.cached_css_file_array =
                        jsc::StrongOptional::create(js, global);
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

    fn on_framework_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        req: SavedRequestUnion,
        resp: AnyResponse,
    ) -> JsResult<()> {
        // PORT NOTE: erase the `&mut RouteBundle` to a raw pointer so subsequent
        // `&self` accesses (vm/router/callback) don't trip borrowck — Zig freely
        // aliased `dev` across this scope.
        let route_bundle: *mut RouteBundle = self.route_bundle_ptr(route_bundle_index);
        debug_assert!(matches!(
            unsafe { &(*route_bundle).data },
            route_bundle::Data::Framework(_)
        ));

        // SAFETY: `route_bundle` points into `self.route_bundles`, which is not
        // resized or dropped for the duration of this fn.
        let framework_bundle = match unsafe { &mut (*route_bundle).data } {
            route_bundle::Data::Framework(f) => f,
            _ => unreachable!(),
        };

        // Extract route params by re-matching the URL
        let mut params: framework_router::MatchedParams = Default::default();
        let url_bunstr = OwnedString::new(match &req {
            // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
            SavedRequestUnion::Stack(r) => BunString::borrow_utf8((**r).url()),
            SavedRequestUnion::Saved(data) => 'brk: {
                // SAFETY: data.request is a live *mut webcore::Request (held strong by ctx)
                let url = unsafe { (*data.request).url.get() };
                url.ref_();
                break 'brk url;
            }
        });
        let url = url_bunstr.to_utf8();

        // Extract pathname from URL (remove protocol, host, query, hash)
        let pathname = extract_pathname_from_url(url.slice());

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

        // SAFETY: `self` is live; `framework_bundle` points into
        // `self.route_bundles[route_bundle_index].data`. Raw-ptr receiver — see
        // PORT NOTE on `compute_arguments_for_framework_request`.
        let args = unsafe {
            Self::compute_arguments_for_framework_request(
                self,
                route_bundle_index,
                framework_bundle,
                params_js_value,
                true,
            )
        }?;

        self.server
            .as_ref()
            .expect("infallible: server bound")
            .on_saved_request(
                req,
                resp,
                server_request_callback,
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
        Ok(())
    }

    fn on_html_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        // PORT NOTE: erase `self` to a raw pointer so the `route_bundle` borrow
        // doesn't conflict with the `&mut self` calls below (Zig held these as
        // plain heap pointers). Per docs/PORTING.md §Global mutable state: hold
        // `*mut T` and deref per-access; do not bind a long-lived `&mut`.
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // SAFETY: `route_bundles` is not reallocated for the duration of this fn.
        let route_bundle: *mut RouteBundle =
            &raw mut unsafe { &mut *self_ptr }.route_bundles[route_bundle_index.get() as usize];
        debug_assert!(matches!(
            unsafe { &(*route_bundle).data },
            route_bundle::Data::Html(_)
        ));

        let blob: *mut StaticRoute = match unsafe { (*route_bundle).data.html().cached_response } {
            Some(b) => b.as_ptr(),
            None => 'generate: {
                // SAFETY: `generate_html_payload` reads `route_bundle.data` /
                // `client_graph` and never reallocates `route_bundles`. No
                // `&mut` into `*route_bundle` is live across this call.
                let payload = unsafe { &mut *self_ptr }
                    .generate_html_payload(route_bundle_index, unsafe { &*route_bundle })
                    .expect("oom");

                let route_ptr = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::HTML),
                        server: unsafe { &*self_ptr }.server,
                        ..Default::default()
                    },
                );
                // SAFETY: per-access reborrow; no other `&` into `*route_bundle` live.
                unsafe {
                    (*route_bundle).data.html_mut().cached_response =
                        ::core::ptr::NonNull::new(route_ptr).map(bun_ptr::BackRef::from)
                };
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

impl DevServer {
    fn generate_html_payload(
        &mut self,
        route_bundle_index: route_bundle::Index,
        route_bundle: &RouteBundle,
    ) -> Result<Vec<u8>, bun_core::Error> {
        // PORT NOTE: Zig passed `*RouteBundle` and `*RouteBundle.HTML` separately
        // (overlapping); re-derive `html` here from `route_bundle.data` so the
        // caller never holds two `&mut` into the same allocation. `route_bundle`
        // is read-only in this fn — `&RouteBundle` suffices.
        let html = route_bundle.data.html();
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
        // SAFETY: html_bundle is a live *mut HTMLBundleRoute (held strong by route_bundle::Html)
        debug_assert!(
            unsafe { (*html.html_bundle).dev_server_id.get() } == Some(route_bundle_index)
        );
        debug_assert!(html.cached_response.is_none());
        let script_injection_offset = html.script_injection_offset.unwrap().get_usize();
        let bundled_html = html.bundled_html_text.as_ref().unwrap();

        // The bundler records an offsets in development mode, splitting the HTML
        // file into two chunks. DevServer is able to insert style/script tags
        // using the information available in IncrementalGraph.
        let before_head_end = &bundled_html[..script_injection_offset];
        let after_head_end = &bundled_html[script_injection_offset..];

        let mut display_name = strings::without_suffix_comptime(
            // SAFETY: html_bundle is a live *mut HTMLBundleRoute (held strong by route_bundle::Html)
            paths::basename(unsafe { &(&(*html.html_bundle).bundle).path }),
            b".html",
        );
        // TODO: function for URL safe chars
        if !strings::is_all_ascii(display_name) || display_name.contains(&b'"') {
            display_name = b"page";
        }

        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets for tracing
        // PERF(port): was stack-fallback (65536)
        let mut gts = self.init_graph_trace_state(0)?;
        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindCss)?;

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
        let n = bun_core::fmt::bytes_to_hex_lower(
            &(route_bundle_index.get() as u32).to_ne_bytes(),
            &mut hex_buf,
        );
        array.extend_from_slice(&hex_buf[..n]);
        let n = bun_core::fmt::bytes_to_hex_lower(
            &route_bundle.client_script_generation.to_ne_bytes(),
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
        import_records: &[Vec<ImportRecord>],
        input_file_sources: &[bun_ast::Source],
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
            bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                &import.path.pretty,
                w,
            )?;
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
        // PORT NOTE: erase `self` to a raw pointer so `route_bundle` borrow
        // doesn't conflict with `generate_client_bundle(&mut self, ..)`.
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // SAFETY: `self_ptr` accesses below touch disjoint fields of `*self`.
        let route_bundle = unsafe { &mut *self_ptr }.route_bundle_ptr(bundle_index);
        let client_bundle: *mut StaticRoute = match route_bundle.client_bundle {
            Some(cb) => cb.as_ptr(),
            None => 'generate: {
                // SAFETY: `generate_client_bundle` does not mutate `route_bundles`.
                let payload = unsafe { &mut *self_ptr }
                    .generate_client_bundle(route_bundle)
                    .expect("oom");
                let route_ptr = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::JAVASCRIPT),
                        server: unsafe { &*self_ptr }.server,
                        ..Default::default()
                    },
                );
                route_bundle.client_bundle =
                    ::core::ptr::NonNull::new(route_ptr).map(bun_ptr::BackRef::from);
                break 'generate route_ptr;
            }
        };
        // SAFETY: `source_maps` is disjoint from `route_bundles`.
        unsafe { &mut *self_ptr }
            .source_maps
            .add_weak_ref(route_bundle.source_map_id());
        // SAFETY: client_bundle is a live boxed StaticRoute owned by route_bundle.client_bundle
        unsafe { StaticRoute::on_with_method(client_bundle, method, resp) };
    }
}

pub enum DevResponse<'a> {
    Http(AnyResponse),
    Promise(PromiseResponse<'a>),
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

    pub type List = bun_collections::pool::SinglyLinkedList<DeferredRequest>;
    pub type Node = bun_collections::pool::Node<DeferredRequest>;

    bun_output::define_scoped_log!(debug_log_dr, DlogeferredRequest, hidden);
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

// LAYERING: `SavedRequestUnion` was a local mirror because `server_body`'s
// copy was unnameable; the canonical enum now lives in `crate::server` so
// `AnyServer::on_saved_request` can name it across the seam.
pub use crate::server::SavedRequestUnion;

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

    fn on_abort_wrapper(this: *mut c_void) {
        // SAFETY: this is &mut DeferredRequest registered in defer_request
        let self_ = unsafe { bun_ptr::callback_ctx::<DeferredRequest>(this) };
        if !self_.is_alive() {
            return;
        }
        self_.on_abort_impl();
    }

    fn on_abort(&mut self, _: AnyResponse) {
        self.on_abort_impl();
    }

    fn on_abort_impl(&mut self) {
        deferred_request::debug_log_dr!(
            "DeferredRequest(0x{:x}) onAbort",
            std::ptr::from_ref(self) as usize
        );
        self.abort();
        debug_assert!(matches!(self.handler, Handler::Aborted));
    }

    /// Actually free the underlying allocation for the node, does not deinitialize children
    fn __free(&mut self) {
        // SAFETY: self is the .data field of a Node in deferred_request_pool
        let node = unsafe {
            bun_core::from_field_ptr!(deferred_request::Node, data, std::ptr::from_mut(self))
        };
        // SAFETY: dev backref is valid while the pool entry exists; `node` is a
        // fully-initialized hive slot. `pool::Node<T>` has no drop glue (`data`
        // is `MaybeUninit`), so `put`'s in-place drop is a no-op — `__deinit`
        // already tore down the payload.
        unsafe {
            (*self.dev.cast_mut()).deferred_request_pool.put(node);
        }
    }

    /// *WARNING*: Do not call this directly, instead call `.deref_()`
    fn __deinit(&mut self) {
        deferred_request::debug_log_dr!(
            "DeferredRequest(0x{:x}) deinitImpl",
            std::ptr::from_ref(self) as usize
        );
        // PORT NOTE: the pool stores `MaybeUninit<DeferredRequest>` (no `Drop`),
        // so the `Handler` payload must be torn down explicitly here. Swap to
        // `Aborted` (zero-payload) and let the moved-out value drop — for
        // `ServerHandler` this releases `saved.js_request: Strong` (the GC
        // handle Zig freed via `js_request.deinit()`).
        let handler = ::core::mem::replace(&mut self.handler, Handler::Aborted);
        match handler {
            Handler::ServerHandler(mut saved) => {
                saved.deinit();
                // `saved` (incl. `js_request: jsc::Strong`) drops at scope exit.
            }
            Handler::BundledHtmlPage(_) | Handler::Aborted => {}
        }
    }

    /// Deinitializes state by aborting the connection.
    fn abort(&mut self) {
        deferred_request::debug_log_dr!(
            "DeferredRequest(0x{:x}) abort",
            std::ptr::from_ref(self) as usize
        );
        let handler = ::core::mem::replace(&mut self.handler, Handler::Aborted);
        match handler {
            Handler::ServerHandler(saved) => {
                deferred_request::debug_log_dr!(
                    "  request url: {}",
                    // SAFETY: saved.request is a live *mut webcore::Request (held strong by ctx)
                    bstr::BStr::new(unsafe { (*saved.request).url.get() }.byte_slice())
                );
                saved
                    .ctx
                    .set_signal_aborted(jsc::CommonAbortReason::ConnectionClosed);
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

impl DevServer {
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
            agent.notify_bundle_start(self.inspector_server_id, &mut trigger_files);
            for s in &mut trigger_files {
                s.deref();
            }
        }

        self.incremental_result.reset();

        // Ref server to keep it from closing.
        if let Some(server) = self.server.as_mut() {
            server.on_pending_request();
        }

        let heap = bun_alloc::MimallocArena::new();
        // TODO(port): heap is moved into BundleV2; errdefer heap.deinit() handled by Drop
        // PORT NOTE: `MimallocArena = bumpalo::Bump` (no `.arena()` accessor);
        // `Bump::alloc` is the inherent method, and `BundleV2::init`'s `alloc`
        // param is `&bun_alloc::Arena` (== `&Bump`).
        // TODO(port): ASTMemoryAllocator scope — bake is an AST crate; arena threading required
        // PORT NOTE: `heap.alloc` returns `&mut T` borrowing `heap`, but `heap` is
        // later moved into `bv2.graph.heap`. Bumpalo chunk storage is heap-allocated
        // and stable across the move of the `Bump` handle, so erase the borrow to a
        // raw pointer (same rationale as `event_loop` below).
        let ast_memory_store: *mut bun_ast::ASTMemoryAllocator =
            heap.alloc(bun_ast::ASTMemoryAllocator::default());
        // SAFETY: the `ASTMemoryAllocator` lives in a bumpalo chunk owned by
        // `heap` → `bv2.graph.heap`; address is stable for the bv2 lifetime,
        // and `_ast_scope` is dropped before `bv2` at end of this fn.
        let _ast_scope = unsafe { &mut *ast_memory_store }.enter();

        // Zig: `.{ .js = dev.vm.eventLoop() }` constructed an `AnyEventLoop`
        // by value; the Rust bundler instead stores
        // `Option<NonNull<AnyEventLoop<'static>>>`. Park the value in `heap`
        // — bumpalo chunks are heap-allocated, so the address is stable across
        // the move of `heap` into `bv2.graph.heap` and lives exactly as long
        // as `bv2`.
        let event_loop: bun_bundler::linker_context_mod::EventLoop =
            Some(::core::ptr::NonNull::from(heap.alloc(
                bun_event_loop::AnyEventLoop::js(self.vm().event_loop().cast()),
            )));

        // PORT NOTE: `BundleV2::init` consumes `heap` and also wants
        // `alloc: &Arena` derived from it. Zig's `heap.arena()` is a
        // `Copy` vtable handle that survives the move; in Rust the `Bump` is
        // moved into `bv2.graph.heap`, so any pre-move borrow would dangle.
        // `BundleV2::init` itself re-derives `linker.graph.bump = &this.graph
        // .heap` internally and only uses `alloc` for short-lived setup —
        // pass the heap's address via raw pointer (it lives at a stable
        // `Box`-interior slot once `init` writes it).
        //
        // SAFETY: `heap_ptr` is read by `BundleV2::init` only after `heap` is
        // moved into `this.graph.heap` (same allocation, stable address inside
        // the freshly-`Box::new`'d `BundleV2`). The borrow is scoped to the
        // call; we never reuse `heap_ptr` after `init` returns.
        let heap_ptr: *const bun_alloc::Arena = &raw const heap;
        // PORT NOTE: split `&mut self` into disjoint field reborrows so
        // `server_transpiler` (`&'a mut`) and `client/ssr_transpiler`
        // (NonNull) don't trip the single-`&mut self` rule.
        let self_ptr = std::ptr::from_mut::<Self>(self);
        let mut bv2: Box<BundleV2<'static>> = BundleV2::init(
            // SAFETY: `server_transpiler` outlives `bv2` (held by `self`).
            unsafe { (*self_ptr).server_transpiler.assume_init_mut() },
            Some(bundler::bundle_v2::BakeOptions {
                framework: self.framework.as_bundler_view(),
                // SAFETY: sibling fields of `*self`; `BundleV2` stores them as
                // raw pointers and never moves them.
                client_transpiler: unsafe {
                    ::core::ptr::NonNull::from((*self_ptr).client_transpiler.assume_init_mut())
                },
                ssr_transpiler: unsafe {
                    ::core::ptr::NonNull::from((*self_ptr).ssr_transpiler.assume_init_mut())
                },
                plugins: self.bundler_options.plugin,
            }),
            // SAFETY: see `heap_ptr` note above.
            unsafe { &*heap_ptr },
            event_loop,
            false, // watching is handled separately
            Some(::core::ptr::NonNull::from(
                bun_threading::work_pool::WorkPool::get(),
            )),
            heap,
        )?;
        bv2.bun_watcher = Some(::core::ptr::NonNull::from(&mut **self.bun_watcher));
        bv2.asynchronous = true;
        // Zig: `linker.dev_server = transpiler.options.dev_server` inside init.
        let dev_handle = self.bundler_handle();
        bv2.dev_server = Some(dev_handle);
        bv2.linker.dev_server = Some(dev_handle);

        {
            self.graph_safety_lock.lock();
            self.client_graph.reset();
            self.server_graph.reset();
            self.graph_safety_lock.unlock();
        }

        // LAYERING: `bun_bundler::bake_types::EntryPointList` is the TYPE_ONLY
        // mirror of this file's `EntryPointList` (moved down so `bun_bundler`
        // can name it without depending on `bun_runtime`). Convert by value —
        // both `Flags` are `#[repr(transparent)] u8` with identical bit layout.
        let start_data = bv2.start_from_bake_dev_server({
            let mut bt = bundler::bake_types::EntryPointList::empty();
            for (k, v) in entry_points.set.iter() {
                bun_core::handle_oom(
                    bt.set
                        .put(k, bundler::bake_types::EntryPointFlags(v.bits())),
                );
            }
            bt
        })?;
        drop(entry_points);
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
        let resolution_failures = &self
            .current_bundle
            .as_ref()
            .expect("infallible: bundle active")
            .resolution_failure_entries;
        if !resolution_failures.is_empty() {
            for (owner, log) in resolution_failures
                .keys()
                .iter()
                .zip(resolution_failures.values())
            {
                if log.has_errors() {
                    // `resolution_failure_entries` keys are `OwnerPacked` (1-bit side + file).
                    let index = owner.file();
                    match owner.side() {
                        bake::Side::Client => self.client_graph.insert_failure(
                            incremental_graph::InsertFailureKey::Index(index),
                            log,
                            false,
                        )?,
                        bake::Side::Server => self.server_graph.insert_failure(
                            incremental_graph::InsertFailureKey::Index(index),
                            log,
                            true,
                        )?,
                    }
                }
            }
        }

        // Theoretically, it shouldn't be possible for errors to leak into dev.log
        if self.log.has_errors() && !self.log.msgs.is_empty() {
            if cfg!(debug_assertions) {
                Output::debug_warn("dev.log should not be written into when using DevServer");
            }
            let _ = self.log.print(std::ptr::from_mut(Output::error_writer()));
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

            total_len +=
                self.incremental_result.failures_removed.len() * ::core::mem::size_of::<u32>();

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
                payload.extend_from_slice(&removed.get_owner().encode().bits().to_le_bytes());
                removed.deinit(self);
            }

            for added in &self.incremental_result.failures_added {
                payload.extend_from_slice(&added.data);

                match added.get_owner() {
                    serialized_failure::Owner::None | serialized_failure::Owner::Route(_) => {
                        unreachable!()
                    }
                    serialized_failure::Owner::Server(index) => {
                        self.server_graph.trace_dependencies(
                            index,
                            &mut gts,
                            incremental_graph::TraceDependencyGoal::NoStop,
                            index,
                        )?
                    }
                    serialized_failure::Owner::Client(index) => {
                        self.client_graph.trace_dependencies(
                            index,
                            &mut gts,
                            incremental_graph::TraceDependencyGoal::NoStop,
                            index,
                        )?
                    }
                }
            }

            // PORT NOTE: iterate by index — the loop bodies need
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
    fn generate_client_bundle(
        &mut self,
        route_bundle: &mut RouteBundle,
    ) -> Result<Vec<u8>, bun_core::Error> {
        debug_assert!(route_bundle.client_bundle.is_none());
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);

        let _lock = self.graph_safety_lock.guard();
        // PORT NOTE: scopeguard closures capture `self` by ref, wedging borrowck for
        // the rest of the fn. Erase to a raw pointer (Zig `defer` had no aliasing check).
        let self_ptr: *mut Self = self;

        // Prepare bitsets
        // PERF(port): was stack-fallback (65536)
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        // `current_chunk_parts`/`current_chunk_len` are scratch buffers shared with
        // the HMR pipeline. We must leave them cleared on every exit path.
        // SAFETY: see `self_ptr` SAFETY above.
        // PORT NOTE: copy `self_ptr` so the `defer!` closure captures a distinct
        // local — otherwise borrowck treats `*self_ptr` as held for the guard's
        // lifetime and rejects later `&mut (*self_ptr).…` reborrows.
        let self_ptr_defer: *mut Self = self_ptr;
        scopeguard::defer! { unsafe { (*self_ptr_defer).client_graph.reset() } };
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindClientModules)?;

        let mut react_fast_refresh_id: &[u8] = b"";
        if let Some(rfr) = &self.framework.react_fast_refresh {
            'brk: {
                let Some(rfr_index) = self.client_graph.get_file_index(&rfr.import_source) else {
                    break 'brk;
                };
                if !self
                    .client_graph
                    .stale_files
                    .is_set(rfr_index.get() as usize)
                {
                    self.client_graph.trace_imports(
                        rfr_index,
                        &mut gts,
                        TraceImportGoal::FindClientModules,
                    )?;
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
                // SAFETY: `self_ptr` is live for the entire fn body; guard runs at scope exit.
                // errdefer: unref on early-`?`; disarmed via `into_inner` on success.
                let guard = scopeguard::guard(script_id, move |id| unsafe {
                    (*self_ptr).source_maps.unref(id)
                });
                gts.clear_and_free();
                // PERF(port): was ArenaAllocator scratch — `take_source_map`
                // allocates internally with the global allocator in the port.
                // SAFETY: see `self_ptr` SAFETY above; `client_graph` is a
                // disjoint field from `source_maps`.
                unsafe { &mut (*self_ptr).client_graph }.take_source_map(entry)?;
                scopeguard::ScopeGuard::into_inner(guard);
            }
            source_map_store::PutOrIncrementRefCount::Shared(_) => {}
        }

        // PORT NOTE: `take_js_bundle` mutably borrows `client_graph` while
        // `initial_entry` would alias `client_graph.bundled_files.keys()[idx]`.
        // Clone the key (a short path string) so the borrow ends before the
        // `&mut client_graph` call; cold path (per-route bundle finalize).
        let initial_entry: Vec<u8> = if let Some(idx) = client_file {
            self.client_graph.bundled_files.keys()[idx.get() as usize].to_vec()
        } else {
            Vec::new()
        };
        let client_bundle =
            self.client_graph
                .take_js_bundle(&incremental_graph::TakeJSBundleOptionsClient {
                    kind: crate::bake::dev_server::ChunkKind::InitialResponse,
                    initial_response_entry_point: &initial_entry,
                    react_refresh_entry_point: react_fast_refresh_id,
                    script_id,
                    console_log: self.should_receive_console_log_from_browser(),
                })?;
        Ok(client_bundle)
    }

    fn generate_css_js_array(&mut self, route_bundle: &RouteBundle) -> JsResult<JSValue> {
        debug_assert!(matches!(
            route_bundle.data,
            route_bundle::Data::Framework(_)
        ));
        if cfg!(debug_assertions) {
            debug_assert!(!route_bundle.data.framework().cached_css_file_array.has());
        }
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);

        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets
        // PERF(port): was stack-fallback (65536)
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindCss)?;

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
            let s = OwnedString::new(BunString::clone_utf8(path));
            arr.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                s.to_js(global)?,
            )?;
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
                // PORT NOTE: copy the two `Type` fields up front so the
                // `&self.router` borrow doesn't overlap `&mut self.*_graph`.
                let (rt_server_file, rt_client_file) = {
                    let rt = self.router.type_ptr_const(route.r#type);
                    (rt.server_file, rt.client_file)
                };

                // Both framework entry points are considered
                self.server_graph.trace_imports(
                    from_opaque_file_id::<{ bake::Side::Server }>(rt_server_file),
                    gts,
                    TraceImportGoal::FindCss,
                )?;
                if let Some(id) = rt_client_file {
                    self.client_graph.trace_imports(
                        from_opaque_file_id::<{ bake::Side::Client }>(id),
                        gts,
                        goal,
                    )?;
                }

                // The route file is considered
                if let Some(id) = route.file_page {
                    self.server_graph.trace_imports(
                        from_opaque_file_id::<{ bake::Side::Server }>(id),
                        gts,
                        goal,
                    )?;
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
                self.client_graph
                    .trace_imports(html.bundled_file, gts, goal)?;
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
            let mut buf = paths::path_buffer_pool::get();
            let s = OwnedString::new(BunString::clone_utf8(
                self.relative_path(&mut *buf, &names[item.get() as usize]),
            ));
            arr.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                s.to_js(global)?,
            )?;
        }
        Ok(arr)
    }
}

pub struct HotUpdateContext<'a> {
    /// bundle_v2.Graph.input_files.items(.source)
    pub sources: &'a [bun_ast::Source],
    /// bundle_v2.Graph.ast.items(.import_records)
    pub import_records: &'a [Vec<ImportRecord>],
    /// bundle_v2.Graph.server_component_boundaries.slice()
    pub scbs: bun_ast::server_component_boundary::Slice<'a>,
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
/// Mirrors Zig `IncrementalGraph(side).FileIndex.Optional`. Side-erased so the
/// `resolved_index_cache` backing slice stores it directly (Zig stored `[]u32`
/// and bit-cast); callers re-tag with the correct `FileIndex<SIDE>` on `unwrap`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct CachedFileIndex(pub u32);
impl CachedFileIndex {
    pub const NONE: Self = Self(u32::MAX);
    #[inline]
    pub const fn raw(self) -> u32 {
        self.0
    }
    #[inline]
    pub fn unwrap<const SIDE: bake::Side>(self) -> Option<incremental_graph::FileIndex<SIDE>> {
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
    pub fn get_cached_index(
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

/// Called at the end of BundleV2 to index bundle contents into the `IncrementalGraph`s
/// This function does not recover DevServer state if it fails (allocation failure)
pub fn finalize_bundle(
    dev: &mut DevServer,
    bv2: &mut BundleV2,
    result: &mut bundler::bundle_v2::DevServerOutput,
) -> JsResult<()> {
    debug_assert!(dev.magic == Magic::Valid);
    // PORT NOTE: `had_sent_hmr_event` is read inside the outer-defer scopeguard
    // and mutated later in the body. Use a `Cell` so the closure capture is `&Cell`
    // (shared), letting the body keep writing through `.set()`.
    let had_sent_hmr_event = ::core::cell::Cell::new(false);

    // TODO(port): the giant `defer` block at the start of finalizeBundle has been
    // moved into a scopeguard. Phase B must verify ordering relative to ?-returns.
    // PORT NOTE: erase `dev`/`bv2` to raw pointers inside the guard so the
    // long-lived closure capture doesn't lock borrowck for the entire fn body
    // (Zig `defer` had no aliasing analysis).
    let dev_ptr = std::ptr::from_mut::<DevServer>(dev);
    let bv2_ptr = std::ptr::from_mut::<BundleV2>(bv2);
    // PORT NOTE: copy the raw ptrs into closure-only locals so `defer!`'s by-ref
    // capture does not hold `*dev_ptr`/`*bv2_ptr` borrowed for the entire fn body.
    let dev_ptr_outer: *mut DevServer = dev_ptr;
    let bv2_ptr_outer: *mut BundleV2 = bv2_ptr;
    scopeguard::defer! {
        // SAFETY: `dev`/`bv2` are `&mut` params; both outlive this fn-scoped guard.
        let dev = unsafe { &mut *dev_ptr_outer };
        let bv2 = unsafe { &mut *bv2_ptr_outer };
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
                    if had_sent_hmr_event.get() { 4 } else { 3 },
                ],
                Opcode::BINARY,
            );
        }

        dev.start_next_bundle_if_present();

        // Unref the ref added in `start_async_bundle`
        if let Some(server) = dev.server.as_mut() {
            server.on_static_request_complete();
        }
    };

    // PORT NOTE: holding `&mut CurrentBundle` for the rest of the fn locks `*dev`
    // mutably. Erase to a raw pointer and reborrow at each use site via the
    // `current_bundle!()` macro (Zig freely re-aliased `dev.current_bundle.?`).
    let current_bundle_ptr: *mut CurrentBundle = dev
        .current_bundle
        .as_mut()
        .expect("infallible: bundle active");
    macro_rules! current_bundle {
        () => {
            // SAFETY: `dev.current_bundle` is `Some` for the entire fn body —
            // it is only set to `None` inside `_outer_defer`, which runs after
            // every use of this macro. `dev.current_bundle` is never reassigned
            // (so the inner `CurrentBundle` is not moved) between here and the
            // outer-defer.
            unsafe { &mut *current_bundle_ptr }
        };
    }
    // PORT NOTE: see `dev_ptr_outer` rationale above — separate copy for the
    // `defer!` capture so `current_bundle!()` keeps reborrowing freely.
    let current_bundle_ptr_defer: *mut CurrentBundle = current_bundle_ptr;
    scopeguard::defer! {
        // SAFETY: see `current_bundle!` SAFETY above; this `defer!` runs
        // before `_outer_defer` (LIFO), so `current_bundle_ptr` is still live.
        let current_bundle = unsafe { &mut *current_bundle_ptr_defer };
        if !current_bundle.requests.first.is_null() {
            // cannot be an assertion because in the case of OOM, the request list was not drained.
            Output::debug(
                "current_bundle.requests.first != null. this leaves pending requests without an error page!",
            );
        }
        while let Some(node) = current_bundle.requests.pop_first() {
            // SAFETY: pop_first returns a live `*mut Node<T>`; `data` was
            // initialized by `defer_request`.
            let req = unsafe { (*node).data.assume_init_mut() };
            req.abort();
            req.deref_();
        }
    };

    let _lock = dev.graph_safety_lock.guard();

    // PORT NOTE: `js_pseudo_chunk()`/`css_chunks()`/`html_chunks()` each take
    // `&mut DevServerOutput`, so calling more than one wedges borrowck. Split
    // `result.chunks` once up front (the three regions are disjoint:
    // `[0] | [1..1+n_css] | [1+n_css..1+n_css+n_html]`).
    let n_css = result.css_file_list.count();
    let n_html = result.html_files.count();
    // PORT NOTE: snapshot `result.chunks` ptr/len before `split_at_mut` so the
    // CSS-chunk loop can re-form the full slice for `intermediate_output.code()`
    // without re-borrowing `result.chunks` (already split).
    let chunks_ptr: *mut bundler::chunk::Chunk = result.chunks.as_mut_ptr();
    let chunks_len = result.chunks.len();
    let (js_chunk_slice, rest_chunks) = result.chunks.split_at_mut(1);
    let js_chunk = &mut js_chunk_slice[0];
    let (css_chunks_mut, html_rest) = rest_chunks.split_at_mut(n_css);
    let html_chunks_mut = &mut html_rest[..n_html];
    let input_file_sources = bv2.graph.input_files.items_source();
    let input_file_loaders = bv2.graph.input_files.items_loader();
    let import_records = bv2.graph.ast.items_import_records();
    let targets = bv2.graph.ast.items_target();
    let scbs = bv2.graph.server_component_boundaries.slice();

    // PERF(port): was stack-fallback (65536) on bv2.arena()
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

    // PORT NOTE: ctx fields `server_seen_bit_set`/`gts` were `undefined` in Zig then
    // assigned AFTER Pass 1 (receive_chunk grows `bundled_files`, so the trace bitsets
    // must be sized post-Pass-1). Seed with empty placeholders; real init below.
    let mut gts_storage = GraphTraceState {
        server_bits: DynamicBitSet::default(),
        client_bits: DynamicBitSet::default(),
    };
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

    for (chunk, metadata) in css_chunks_mut.iter_mut().zip(result.css_file_list.values()) {
        debug_assert!(matches!(chunk.content, bundler::chunk::Content::Css(_)));

        let index = bun_ast::Index::init(chunk.entry_point.source_index());

        // PORT NOTE: `IntermediateOutput::code` takes `&mut self` (a field of
        // `*chunk`) plus `chunk: &Chunk` and `chunks: &[Chunk]`; borrowck still
        // rejects the overlap (`&mut chunk.intermediate_output` aliases the
        // shared `&chunk` / `&chunks[..]`). Zig aliased freely. Split via raw
        // pointers — the callee never reborrows `chunk.intermediate_output`
        // through the `chunk`/`chunks` params (it reads metadata only).
        let code = {
            let chunk_ptr: *mut bundler::chunk::Chunk = chunk;
            // SAFETY: `intermediate_output` is a disjoint field of `*chunk`;
            // `code()` does not access it via the `chunk`/`chunks` arguments.
            let io = unsafe { &mut (*chunk_ptr).intermediate_output };
            io.code(
                None,
                &bv2.graph,
                &bv2.linker.graph,
                b"THIS_SHOULD_NEVER_BE_EMITTED_IN_DEV_MODE",
                // SAFETY: see above; shared reborrow of the same allocation,
                // disjoint from the `&mut intermediate_output` receiver.
                unsafe { &*chunk_ptr },
                // SAFETY: `result.chunks` outlives this loop body; Zig passed
                // the same slice while iterating it. `chunks_ptr/len` were
                // snapshotted before `split_at_mut`; `code()` only reads.
                unsafe { ::core::slice::from_raw_parts(chunks_ptr, chunks_len) },
                None,
                false,
                false,
            )?
        };

        // Create an entry for this file.
        let key = ctx.sources[index.get() as usize]
            .path
            .key_for_incremental_graph();
        // TODO: use a hash mix with the first half being a path hash and the second half content hash
        let h = hash(key);
        // Track css files that look like tailwind files.
        // PORT NOTE: hoisted before `replace_path` because that consumes
        // `code.buffer`; same observable order as Zig (buffer is identical
        // pre- and post-asset-registration there).
        let looks_like_tailwind = dev.has_tailwind_plugin_hack.is_some() && {
            let first_1024 = &code.buffer[..code.buffer.len().min(1024)];
            strings::index_of(first_1024, b"tailwind").is_some()
        };
        let asset_index = dev.assets.replace_path(
            key,
            crate::webcore::blob::Any::from_owned_slice(code.buffer.into()),
            &MimeType::CSS,
            h,
        )?;
        // Later code needs to retrieve the CSS content
        // The hack is to use `entry_point_id`, which is otherwise unused, to store an index.
        chunk
            .entry_point
            .set_entry_point_id(asset_index.get() as u32);

        if let Some(map) = &mut dev.has_tailwind_plugin_hack {
            if looks_like_tailwind {
                // PORT NOTE: `get_or_put` consumes the key by value; on miss the key
                // already lives in the map so the explicit `*key_ptr =` is redundant.
                let _ = map.get_or_put(Box::from(key))?;
            } else {
                let _ = map.swap_remove(&Box::<[u8]>::from(key));
            }
        }

        dev.client_graph.receive_chunk(
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

    for chunk in html_chunks_mut.iter_mut() {
        let index = bun_ast::Index::init(chunk.entry_point.source_index());
        let bundler::CompileResult::Html {
            code: compile_result_code,
            script_injection_offset: compile_result_offset,
            ..
        } = &chunk.compile_results_for_chunk[0]
        else {
            unreachable!()
        };
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
        if route_bundle
            .data
            .html_mut()
            .cached_response
            .take()
            .is_some()
        {
            // SAFETY: `route_bundle` borrows `dev.route_bundles[_]`; `source_maps`
            // is a disjoint field reborrowed through the raw `dev_ptr`.
            route_bundle.invalidate_client_bundle(unsafe { &mut (*dev_ptr).source_maps });
        }
        let html = match &mut route_bundle.data {
            route_bundle::Data::Html(h) => h,
            _ => unreachable!(),
        };
        if let Some(_slice) = html.bundled_html_text.take() {
            // freed by Drop
        }
        html.bundled_html_text = Some(compile_result_code.clone()); // TODO(port): ownership transfer
        html.script_injection_offset = Some(route_bundle::ByteOffset::init(*compile_result_offset));

        chunk
            .entry_point
            .set_entry_point_id(u32::try_from(route_bundle_index.get()).expect("int cast"));
    }

    // Zig: `var gts = try dev.initGraphTraceState(...); ctx.gts = &gts;` — sized AFTER
    // Pass 1 so server/client bitsets cover files just inserted by `receive_chunk`.
    *ctx.gts = dev.init_graph_trace_state(if n_css > 0 {
        input_file_sources.len()
    } else {
        0
    })?;
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
    for chunk in html_chunks_mut.iter() {
        let index = bun_ast::Index::init(chunk.entry_point.source_index());
        dev.client_graph.process_chunk_dependencies(
            &mut ctx,
            incremental_graph::ProcessMode::Normal,
            index,
        )?;
    }
    for chunk in css_chunks_mut.iter() {
        let entry_index = bun_ast::Index::init(chunk.entry_point.source_index());
        dev.client_graph.process_chunk_dependencies(
            &mut ctx,
            incremental_graph::ProcessMode::Css,
            entry_index,
        )?;
    }

    // Index all failed files now that the incremental graph has been updated.
    if !dev.incremental_result.failures_removed.is_empty()
        || !dev.incremental_result.failures_added.is_empty()
    {
        had_sent_hmr_event.set(true);
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
            current_bundle!().timer.elapsed().as_millis(),
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
                let mut source_map_entry = source_map_store::Entry::default();
                source_map_entry.ref_count = 1;

                // Fill the source map entry
                // PERF(port): was ArenaAllocator
                dev.server_graph.take_source_map(&mut source_map_entry)?;
                // PORT NOTE: erase to raw ptr so `render_json` can borrow the entry
                // while the cleanup guard is armed (Zig `defer` had no aliasing check).
                let entry_ptr: *mut source_map_store::Entry = &raw mut source_map_entry;
                // SAFETY: `source_map_entry` is a stack local that outlives this guard.
                scopeguard::defer! {
                    unsafe {
                        (*entry_ptr).ref_count = 0;
                        (*entry_ptr).deinit();
                    }
                };

                let json_data =
                    source_map_entry.render_json(dev, ChunkKind::HmrChunk, bake::Side::Server)?;
                break 'json Some(json_data);
            }
        } else {
            None
        };
        // _ = source_map_json freed by Drop

        let server_bundle = dev.server_graph.take_js_bundle_server(
            &incremental_graph::TakeJSBundleOptionsServer {
                kind: ChunkKind::HmrChunk,
                script_id: server_script_id,
            },
        )?;
        // freed by Drop

        let global = dev.global();
        let server_modules = if let Some(json) = source_map_json {
            // This memory will be owned by the `DevServerSourceProvider` in C++
            let json: ::core::mem::ManuallyDrop<Vec<u8>> = ::core::mem::ManuallyDrop::new(json);

            match c::bake_load_server_hmr_patch_with_source_map(
                global,
                BunString::clone_utf8(&server_bundle),
                json.as_ptr(),
                json.len(),
            ) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime;
                    // `print_error_like_object_to_console` needs `&mut`.
                    dev.vm_mut()
                        .print_error_like_object_to_console(global.take_exception(err));
                    // PORT NOTE: Zig `@panic` aborts; Rust `panic!()` would unwind
                    // through the `extern "C"` boundary above (`nounwind` UB).
                    bun_core::Output::panic(format_args!(
                        "Error thrown while evaluating server code. This is always a bug in the bundler."
                    ));
                }
            }
        } else {
            match c::bake_load_server_hmr_patch(global, BunString::clone_latin1(&server_bundle)) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime;
                    // `print_error_like_object_to_console` needs `&mut`.
                    dev.vm_mut()
                        .print_error_like_object_to_console(global.take_exception(err));
                    // PORT NOTE: Zig `@panic` aborts; Rust `panic!()` would unwind
                    // through the `extern "C"` boundary above (`nounwind` UB).
                    bun_core::Output::panic(format_args!(
                        "Error thrown while evaluating server code. This is always a bug in the bundler."
                    ));
                }
            }
        };
        // PORT NOTE: `make_array_for_server_components_patch` needs `&mut self`
        // while reading `self.incremental_result.client_components_{added,removed}`.
        // It only touches `server_graph.bundled_files.keys()`, so reborrow the
        // index slices via `dev_ptr` (disjoint fields).
        // SAFETY: `dev_ptr == dev`; `incremental_result` is not mutated by
        // `make_array_for_server_components_patch`.
        let (added, removed) = unsafe {
            let ir = &(*dev_ptr).incremental_result;
            (
                ir.client_components_added.as_slice(),
                ir.client_components_removed.as_slice(),
            )
        };
        let errors = match dev.server_register_update_callback.get().unwrap().call(
            global,
            global.to_js_value(),
            &[
                server_modules,
                dev.make_array_for_server_components_patch(global, added)?,
                dev.make_array_for_server_components_patch(global, removed)?,
            ],
        ) {
            Ok(v) => v,
            Err(err) => {
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                dev.vm_mut()
                    .print_error_like_object_to_console(global.take_exception(err));
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

        for index in &dev.incremental_result.client_components_affected {
            dev.server_graph.trace_dependencies(
                *index,
                ctx.gts,
                incremental_graph::TraceDependencyGoal::NoStop,
                *index,
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
            dev.route_bundles[bundled_route_index].invalidate_client_bundle(&mut dev.source_maps);
        }
    } else if !dev.incremental_result.html_routes_hard_affected.is_empty() {
        // Free old bundles
        let mut it = route_bits_client.iterator::<true, true>();
        while let Some(bundled_route_index) = it.next() {
            dev.route_bundles[bundled_route_index].invalidate_client_bundle(&mut dev.source_maps);
        }
    }

    // Softly affected HTML routes only need the bundle invalidated.
    if !dev.incremental_result.html_routes_soft_affected.is_empty() {
        for index in &dev.incremental_result.html_routes_soft_affected {
            dev.route_bundles[index.get() as usize].invalidate_client_bundle(&mut dev.source_maps);
            route_bits.set(index.get() as usize);
        }
        has_route_bits_set = true;
    }

    // `route_bits` will have all of the routes that were modified.
    if has_route_bits_set && (will_hear_hot_update || dev.incremental_result.had_adjusted_edges) {
        // PORT NOTE: copy out before the loop so the `&mut RouteBundle` borrow
        // below doesn't overlap a `&dev.incremental_result` read.
        let had_adjusted_edges = dev.incremental_result.had_adjusted_edges;
        let mut it = route_bits.iterator::<true, true>();
        // List 2
        while let Some(i) = it.next() {
            // PORT NOTE: erase to raw ptr — `trace_all_route_imports` below needs
            // `&mut *dev` while `route_bundle` (a sub-borrow of `dev.route_bundles`)
            // is still live; the two do not actually alias.
            let route_bundle: *mut RouteBundle = dev.route_bundle_ptr(route_bundle::Index::init(
                u32::try_from(i).expect("int cast"),
            ));
            // SAFETY: `route_bundle` points into `dev.route_bundles`, which is not
            // resized inside this loop; `trace_all_route_imports` does not mutate
            // `route_bundles`.
            let route_bundle = unsafe { &mut *route_bundle };
            if had_adjusted_edges {
                match &mut route_bundle.data {
                    route_bundle::Data::Framework(fw_bundle) => {
                        fw_bundle.cached_css_file_array.clear_without_deallocation()
                    }
                    route_bundle::Data::Html(html) => {
                        if let Some(blob) = html.cached_response.take() {
                            // Arc<StaticRoute> drop = .deref()
                            let _ = blob;
                        }
                    }
                }
            }
            if route_bundle.active_viewers == 0 || !will_hear_hot_update {
                continue;
            }
            w_int!(i32, i32::try_from(i).expect("int cast"));

            // If no edges were changed, then it is impossible to
            // change the list of CSS files.
            if had_adjusted_edges {
                ctx.gts.clear();
                dev.client_graph.current_css_files.clear();
                dev.trace_all_route_imports(route_bundle, ctx.gts, TraceImportGoal::FindCss)?;
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

    let css_chunks = &*css_chunks_mut;
    if will_hear_hot_update {
        if dev.client_graph.current_chunk_len > 0 || !css_chunks.is_empty() {
            // Send CSS mutations
            let asset_values = dev.assets.files.values();
            w_int!(u32, u32::try_from(css_chunks.len()).expect("int cast"));
            use bun_bundler::Graph::InputFileColumns as _;
            let sources = bv2.graph.input_files.items_source();
            for chunk in css_chunks {
                let key = sources[chunk.entry_point.source_index() as usize]
                    .path
                    .key_for_incremental_graph();
                let mut hex = [0u8; 16];
                let n = bun_core::fmt::bytes_to_hex_lower(&hash(key).to_ne_bytes(), &mut hex);
                w_all!(&hex[..n]);
                // SAFETY: `asset_values[i]` is `*mut StaticRoute` owned by `dev.assets`.
                let css_data =
                    &unsafe { &*asset_values[chunk.entry_point.entry_point_id() as usize] }
                        .blob
                        .internal_blob()
                        .bytes;
                w_int!(u32, u32::try_from(css_data.len()).expect("int cast"));
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
                        if let Some(map) = values[part.get() as usize].source_map.get() {
                            source_map_hash.update(map.vlq());
                        }
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
                let entry = match dev
                    .source_maps
                    .put_or_increment_ref_count(script_id, sockets)?
                {
                    source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => 'brk: {
                        // PORT NOTE: reborrow `client_graph` via `dev_ptr` so the
                        // `&mut Entry` borrow inside `source_maps` does not alias.
                        // SAFETY: `dev_ptr` is live for this fn; disjoint fields.
                        unsafe { &mut (*dev_ptr).client_graph }.take_source_map(entry)?;
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
        had_sent_hmr_event.set(true);
    }

    if !dev.incremental_result.failures_added.is_empty() {
        dev.bundles_since_last_error = 0;

        // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
        // PORT NOTE: erase the agent borrow to a raw pointer so it can be passed
        // through `send_serialized_failures` (which also borrows `dev`) and then
        // re-used below — Zig passed the optional pointer by value.
        let mut inspector_agent_ptr: Option<*mut BunFrontendDevServerAgent> =
            unsafe { dev.inspector() }.map(|a| std::ptr::from_mut(a));
        if current_bundle!().promise.strong.has_value() {
            // SAFETY: see `current_bundle!` SAFETY; guard runs before `_outer_defer`.
            // PORT NOTE: copy the raw ptr so `defer!`'s by-ref capture does not
            // hold `*current_bundle_ptr` borrowed across `current_bundle!()` uses.
            let cb_ptr_defer: *mut CurrentBundle = current_bundle_ptr;
            scopeguard::defer! { unsafe { (*cb_ptr_defer).promise.reset() } };
            current_bundle!()
                .promise
                .set_route_bundle_state(dev, route_bundle::State::PossibleBundlingFailures);
            let global = dev.global();
            // PORT NOTE: `bundling_failures` lives on `*dev` but
            // `send_serialized_failures` needs `&mut self`; reborrow the keys
            // through `dev_ptr` (Zig passed `dev.bundling_failures.keys()` by
            // value with no aliasing check). The callee never touches
            // `bundling_failures`.
            // SAFETY: `dev_ptr` is live for the entire fn body (see line 3133).
            let failures = unsafe { (*dev_ptr).bundling_failures.values() };
            dev.send_serialized_failures(
                DevResponse::Promise(PromiseResponse {
                    promise: current_bundle!().promise.strong.take(),
                    global,
                }),
                failures,
                ErrorPageKind::Bundler,
                // SAFETY: agent ptr is from `dev.inspector()` just above; live for this scope.
                inspector_agent_ptr.map(|p| unsafe { &mut *p }),
            )?;
        }

        while let Some(node) = current_bundle!().requests.pop_first() {
            // SAFETY: `pop_first` hands back ownership of the intrusive node;
            // `data` was initialized by `defer_request`.
            let req = unsafe { (*node).data.assume_init_mut() };
            let req_ptr = std::ptr::from_mut::<DeferredRequest>(req);
            // SAFETY: the node stays alive until `deref_()` releases it below.
            scopeguard::defer! { unsafe { (*req_ptr).deref_() } };

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

            // SAFETY: see PORT NOTE on `failures` above; `dev_ptr` is live and
            // `send_serialized_failures` does not mutate `bundling_failures`.
            let failures = unsafe { (*dev_ptr).bundling_failures.values() };
            dev.send_serialized_failures(
                resp,
                failures,
                ErrorPageKind::Bundler,
                // SAFETY: agent ptr is from `dev.inspector()` above; live for this scope.
                inspector_agent_ptr.take().map(|p| unsafe { &mut *p }),
            )?;
        }
        if let Some(agent_ptr) = inspector_agent_ptr {
            let mut buf: Vec<u8> = Vec::new();
            // SAFETY: agent ptr is from `dev.inspector()` above; live for this scope.
            dev.encode_serialized_failures(
                dev.bundling_failures.values(),
                &mut buf,
                Some(unsafe { &mut *agent_ptr }),
            )?;
        }

        return Ok(());
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
                Output::pretty_error(format_args!(
                    "<cyan>[x{}]<r> ",
                    dev.bundles_since_last_error
                ));
            }
        } else {
            dev.bundles_since_last_error = 0;
            dev.print_memory_line();
        }

        let ms_elapsed = u64::try_from(current_bundle!().timer.elapsed().as_millis()).unwrap();

        Output::pretty_error(format_args!(
            "<green>{} in {}ms<r>",
            if current_bundle!().had_reload_event {
                "Reloaded"
            } else {
                "Bundled page"
            },
            ms_elapsed,
        ));

        // Intentionally creating a new scope here so we can limit the lifetime
        // of the `relative_path_buf`
        {
            let mut buf = paths::path_buffer_pool::get();

            // Compute a file name to display
            let file_name: Option<&[u8]> = if current_bundle!().had_reload_event {
                if !bv2.graph.entry_points.is_empty() {
                    Some(dev.relative_path(&mut *buf, {
                        use bun_bundler::Graph::InputFileColumns as _;
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
                        let first = current_bundle!().requests.first;
                        if !first.is_null() {
                            // SAFETY: first is an intrusive list node valid while current_bundle.requests holds it
                            // SAFETY: `data` was initialized by `defer_request`.
                            break 'rbi unsafe { (*first).data.assume_init_ref() }
                                .route_bundle_index;
                        }
                        let route_bundle_indices =
                            current_bundle!().promise.route_bundle_indices.keys();
                        if route_bundle_indices.is_empty() {
                            break 'brk None;
                        }
                        break 'rbi route_bundle_indices[0];
                    };

                    // PORT NOTE: index `route_bundles` immutably so `dev.relative_path`
                    // / `dev.router` / `dev.server_graph` reads below stay disjoint.
                    break 'brk match &dev.route_bundles[route_bundle_index.get() as usize].data {
                        route_bundle::Data::Html(html) => {
                            Some(dev.relative_path(
                                &mut *buf,
                                &unsafe { &*html.html_bundle }.bundle.path,
                            ))
                        }
                        route_bundle::Data::Framework(fw) => 'file_name: {
                            let route = dev.router.route_ptr(fw.route_index);
                            let opaque_id = match route.file_page.or(route.file_layout) {
                                Some(id) => id,
                                None => break 'file_name None,
                            };
                            let server_index =
                                from_opaque_file_id::<{ bake::Side::Server }>(opaque_id);
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
        if let Some(agent) = unsafe { dev.inspector() } {
            agent.notify_bundle_complete(dev.inspector_server_id, ms_elapsed as f64);
        }
    }

    // Release the lock because the underlying handler may acquire one.
    dev.graph_safety_lock.unlock();
    // SAFETY: `dev_ptr` is live for the entire fn body; runs before `_lock` (LIFO),
    // so the outer unlock guard sees a locked state again.
    scopeguard::defer! { unsafe { (*dev_ptr).graph_safety_lock.lock() } };

    // Set all the deferred routes to the .loaded state up front
    {
        let mut node = current_bundle!().requests.first;
        while !node.is_null() {
            // SAFETY: node is an intrusive list node valid while current_bundle.requests holds it;
            // `data` was initialized by `defer_request`.
            let n = unsafe { &*node };
            let rb = dev.route_bundle_ptr(unsafe { n.data.assume_init_ref() }.route_bundle_index);
            rb.server_state = route_bundle::State::Loaded;
            node = n.next;
        }
    }

    if current_bundle!().promise.strong.has_value() {
        // SAFETY: see `current_bundle!` SAFETY; guard runs before `_outer_defer`.
        // PORT NOTE: copy the raw ptr so `defer!`'s by-ref capture does not
        // hold `*current_bundle_ptr` borrowed across `current_bundle!()` uses.
        let cb_ptr_defer: *mut CurrentBundle = current_bundle_ptr;
        scopeguard::defer! { unsafe { (*cb_ptr_defer).promise.deinit_idempotently() } };
        current_bundle!()
            .promise
            .set_route_bundle_state(dev, route_bundle::State::Loaded);
        let vm = dev.vm();
        let _exit = vm.enter_event_loop_scope();
        current_bundle!()
            .promise
            .strong
            .resolve(vm.global(), JSValue::TRUE)?;
    }

    while let Some(node) = current_bundle!().requests.pop_first() {
        // SAFETY: `pop_first` hands back ownership of the intrusive node;
        // `data` was initialized by `defer_request`.
        let req = unsafe { (*node).data.assume_init_mut() };
        let req_ptr = std::ptr::from_mut::<DeferredRequest>(req);
        // SAFETY: the node stays alive until `deref_()` releases it below.
        scopeguard::defer! { unsafe { (*req_ptr).deref_() } };

        let rb = dev.route_bundle_ptr(req.route_bundle_index);
        rb.server_state = route_bundle::State::Loaded;

        // PORT NOTE: `SavedRequest` is move-only (`Strong` field). Take the
        // handler by value so the `Saved` payload moves into the union; the
        // node is being torn down via `_deref` regardless.
        match ::core::mem::replace(&mut req.handler, Handler::Aborted) {
            Handler::Aborted => continue,
            Handler::ServerHandler(saved) => {
                let response = saved.response;
                let ctx = saved.ctx;
                // PORT NOTE: Zig copied `saved` by value into the call and let
                // `defer req.deref()` → `__deinit` → `saved.deinit()` release
                // the original (`js_request.deinit()` + `ctx.deref()`). The
                // Rust port moves `saved` out (so `__deinit` sees `Aborted`);
                // `js_request: StrongOptional` releases on Drop, but
                // `ctx: AnyRequestContext` is `Copy` — explicitly balance the
                // `ctx.ref_()` from `defer_request` here so the request
                // context's `on_request_complete` (and thus the server's
                // `pending_requests--`) eventually fires. Without this the
                // bake-harness graceful-exit deinit check ("Failed to trigger
                // deinit") never sees DevServer Drop.
                scopeguard::defer! { ctx.deref() };
                dev.on_framework_request_with_bundle(
                    req.route_bundle_index,
                    SavedRequestUnion::Saved(saved),
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

impl DevServer {
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
                        // SAFETY: `self_ptr` is `self`; `current` borrows
                        // `self.watcher_atomics.events[_]`, disjoint from the
                        // graph/watcher fields `process_file_list` mutates.
                        current.process_file_list(unsafe { &mut *self_ptr }, &mut entry_points);
                        let Some(next) = self.watcher_atomics.recycle_event_from_dev_server(
                            std::ptr::from_mut::<HotReloadEvent>(current),
                        ) else {
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

            // PORT NOTE: iterate by index — `route_bundle_ptr` /
            // `append_route_entry_points_if_not_stale` need `&mut self`,
            // conflicting with the `keys()` iterator borrow.
            for i in 0..self.next_bundle.route_queue.len() {
                let route_bundle_index = self.next_bundle.route_queue.keys()[i];
                let rb = self.route_bundle_ptr(route_bundle_index);
                rb.server_state = route_bundle::State::Bundling;
                self.append_route_entry_points_if_not_stale(&mut entry_points, route_bundle_index)
                    .expect("oom");
            }

            if !entry_points.set.is_empty() {
                self.start_async_bundle(entry_points, is_reload, timer)
                    .expect("oom");
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
        let _g = self.graph_safety_lock.guard();

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
                bake::Graph::Server => self.server_graph.insert_failure(
                    incremental_graph::InsertFailureKey::AbsPath(abs_path),
                    log,
                    false,
                )?,
                bake::Graph::Ssr => self.server_graph.insert_failure(
                    incremental_graph::InsertFailureKey::AbsPath(abs_path),
                    log,
                    true,
                )?,
                bake::Graph::Client => self.client_graph.insert_failure(
                    incremental_graph::InsertFailureKey::AbsPath(abs_path),
                    log,
                    false,
                )?,
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

        let _g = self.graph_safety_lock.guard();

        // TODO(port): `switch (graph == .client) { inline else => |is_client| ... }` — unrolled
        let owner: serialized_failure::OwnerPacked = if graph == bake::Graph::Client {
            let idx = self.client_graph.insert_stale(abs_path, false)?;
            serialized_failure::OwnerPacked::new(bake::Side::Client, idx.get())
        } else {
            let idx = self
                .server_graph
                .insert_stale(abs_path, graph == bake::Graph::Ssr)?;
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
    pub kind: FileKind,
}

impl DevServer {
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

        let _g = self.graph_safety_lock.guard();

        // TODO(port): switch (side) { inline else => |side_comptime| ... } — unrolled
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
    fn from(v: OpaqueFileId) -> Self {
        Self::Id(v)
    }
}
impl From<framework_router::OpaqueFileIdOptional> for OpaqueFileIdOrOptional {
    fn from(v: framework_router::OpaqueFileIdOptional) -> Self {
        Self::Optional(v)
    }
}

fn on_request(dev: &mut DevServer, req: &mut Request, mut resp: AnyResponse) {
    let mut params: framework_router::MatchedParams = Default::default();
    if let Some(route_index) = dev.router.match_slow(req.url(), &mut params) {
        let route_bundle_index = dev
            .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
            .expect("oom");
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev: std::ptr::from_mut::<DevServer>(dev),
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::ServerHandler,
            route_bundle_index,
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(dev, rbi, &mut ctx) {
            Ok(()) => {}
            Err(e @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) => {
                dev.vm().global().report_active_exception_as_unhandled(e)
            }
            Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
        }
        return;
    }

    if dev
        .server
        .as_ref()
        .expect("infallible: server bound")
        .config()
        .on_request
        .is_some()
    {
        dev.server
            .as_mut()
            .expect("infallible: server bound")
            .on_request(req, resp);
        return;
    }

    send_built_in_not_found(&mut resp);
}

impl DevServer {
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
            let route_bundle_index = self
                .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                .expect("oom");
            let mut ctx = RequestEnsureRouteBundledCtx {
                dev: std::ptr::from_mut::<DevServer>(self),
                req: ReqOrSaved::Saved(saved_request),
                resp,
                kind: deferred_request::HandlerKind::ServerHandler,
                route_bundle_index,
            };
            let rbi = ctx.route_bundle_index;
            // Found a matching route, bundle it and handle the request
            match ensure_route_is_bundled(self, rbi, &mut ctx) {
                Ok(()) => {}
                Err(jsc::JsError::OutOfMemory) => return Err(bun_core::err!(OutOfMemory).into()),
                Err(e @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) => {
                    self.vm().global().report_active_exception_as_unhandled(e);
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
        html: *mut HTMLBundleRoute,
        req: &mut Request,
        resp: AnyResponse,
    ) -> Result<(), AllocError> {
        let route_bundle_index = self
            .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))
            .map_err(|_| AllocError)?;
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev: std::ptr::from_mut::<DevServer>(self),
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::BundledHtmlPage,
            route_bundle_index,
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(self, rbi, &mut ctx) {
            Ok(()) => {}
            Err(e @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) => {
                self.vm().global().report_active_exception_as_unhandled(e)
            }
            Err(jsc::JsError::OutOfMemory) => return Err(AllocError),
        }
        Ok(())
    }

    fn get_or_put_route_bundle(
        &mut self,
        route: route_bundle::UnresolvedIndex,
    ) -> Result<route_bundle::Index, bun_core::Error> {
        let index_location: *mut route_bundle::IndexOptional = match route {
            route_bundle::UnresolvedIndex::Framework(route_index) => {
                &raw mut self.router.route_ptr_mut(route_index).bundle
            }
            route_bundle::UnresolvedIndex::Html(html) => {
                // SAFETY: caller guarantees `html` is a live IntrusiveRc-managed
                // allocation; single-threaded (uws JS-thread callback).
                // R-2: `dev_server_id` is `Cell<Option<Index>>`; `Cell::as_ptr`
                // yields the inner `*mut Option<Index>` so the `*index_location`
                // read/write below stays raw and matches the framework arm's type.
                unsafe { (*html).dev_server_id.as_ptr() }
            }
        };
        // SAFETY: index_location points into self/html which outlive this fn
        if let Some(bundle_index) = unsafe { *index_location } {
            return Ok(bundle_index);
        }

        let _g = self.graph_safety_lock.guard();

        let bundle_index =
            route_bundle::Index::init(u32::try_from(self.route_bundles.len()).expect("int cast"));

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
                    // SAFETY: caller guarantees `html` is live; single-threaded.
                    // R-2: shared deref — only `bundle.path` is read; mutation of
                    // `dev_server_id` goes through the `Cell` `index_location` above.
                    let html_ref = unsafe { &*html };
                    let incremental_graph_index =
                        self.client_graph
                            .insert_stale_extra(&html_ref.bundle.path, false, true)?;
                    let file = &mut self.client_graph.bundled_files.values_mut()
                        [incremental_graph_index.get() as usize];
                    // PORT NOTE: Zig packs/unpacks; the un-gated `incremental_graph::File`
                    // is unpacked already.
                    file.html_route_bundle_index = Some(bundle_index);
                    // Zig `.initRef(html)` — bump intrusive refcount; matched by
                    // `RouteBundle::deinit`'s deref of `html_bundle`.
                    // SAFETY: `html` is a live IntrusiveRc-managed allocation.
                    unsafe { bun_ptr::RefCount::<HTMLBundleRoute>::ref_(html) };
                    break 'brk route_bundle::Data::Html(route_bundle::Html {
                        html_bundle: html,
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
        unsafe { *index_location = Some(bundle_index) };
        Ok(bundle_index)
    }

    fn register_catch_all_html_route(
        &mut self,
        html: *mut HTMLBundleRoute,
    ) -> Result<(), bun_core::Error> {
        let _bundle_index =
            self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))?;
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
        // Zero-extend then encode in place; `encode_len` is an upper bound so
        // truncate to the actual encoded length afterward. Avoids the
        // `spare_capacity_mut` + `set_len` unsafe dance for a one-shot path.
        buf.resize(failures_start_buf_pos + len, 0);
        let written = bun_base64::encode(&mut buf[failures_start_buf_pos..], &all_failures);
        buf.truncate(failures_start_buf_pos + written);

        // Re-use the encoded buffer to avoid encoding failures more times than neccecary.
        if let Some(agent) = inspector_agent {
            debug_assert!(agent.is_enabled());
            let failures_encoded = &buf[failures_start_buf_pos..];
            // base64 output is pure ASCII so a UTF-8 borrow is byte-identical to
            // Zig's `BunString.initLatin1OrASCIIView`.
            let mut s = BunString::borrow_utf8(failures_encoded);
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
            bun_core::Global::package_json_version_with_canary,
            "\"};"
        );
        let post = "</script></body></html>";

        buf.extend_from_slice(pre.as_bytes());
        buf.extend_from_slice(
            bun_core::runtime_embed_file!(CodegenEager, "bake.error.js").as_bytes(),
        );
        buf.extend_from_slice(post.as_bytes());

        match resp {
            DevResponse::Http(r) => StaticRoute::send_blob_then_deinit(
                r,
                crate::webcore::blob::Any::from_array_list(buf),
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
                let mut headers = bun_http_jsc::headers_jsc::from_fetch_headers(
                    None,
                    crate::webcore::headers_ref::any_blob_content_type(&any_blob),
                );
                headers.append(b"Content-Type", &MimeType::HTML.value);
                if headers.get(b"etag").is_none() && !any_blob.slice().is_empty() {
                    bun_http::headers::append_etag(any_blob.slice(), &mut headers);
                }
                let fetch_headers = bun_http_jsc::headers_jsc::to_fetch_headers(&headers, global)?;
                // SAFETY: `to_fetch_headers` returns a fresh +1 `FetchHeaders*`;
                // ownership is transferred to `HeadersRef`.
                let headers_ref =
                    unsafe { crate::webcore::response::HeadersRef::adopt(fetch_headers) };
                let mut response: Response = Response::init(
                    crate::webcore::response::Init {
                        status_code: 500,
                        headers: Some(headers_ref),
                        ..Default::default()
                    },
                    crate::webcore::Body::new(crate::webcore::body::Value::Blob(
                        any_blob.to_blob(global),
                    )),
                    BunString::empty(),
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
        Output::pretty_errorln(format_args!(
            "<d>DevServer tracked {}, process: {}<r>",
            bun_core::fmt::size(self.memory_cost(), Default::default()),
            bun_core::fmt::size(
                sys::self_process_memory_usage().unwrap_or(0),
                Default::default()
            ),
        ));
    }
}

// PORT NOTE: FileKind/ChunkKind/TraceImportGoal/IncrementalResult/GraphTraceState
// are defined once in `crate::bake::dev_server` and re-exported here so the
// Phase-A draft body and the keystone struct module agree on identity.
pub use crate::bake::dev_server::FileKind;

pub use crate::bake::dev_server::IncrementalResult;

/// Used during an incremental update to determine what "HMR roots"
/// are affected. Re-exported from the keystone `dev_server` module so that
/// `HotUpdateContext.gts` and `IncrementalGraph::trace_dependencies` agree on
/// a single type (the body-local duplicate caused E0308).
pub use crate::bake::dev_server::GraphTraceState;

// GraphTraceState::deinit → Drop on DynamicBitSet (allocator param dropped)

pub use crate::bake::dev_server::TraceImportGoal;

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
        Ok(GraphTraceState {
            server_bits,
            client_bits,
        })
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

    let file = sys::File::create(inner_dir.fd, paths::basename(name), true)?;
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
    _ = file.close();
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
    let size = bun_core::replacement_size(rel_path, from.as_bytes(), to.as_bytes());
    let _ = bun_core::replace(rel_path, from.as_bytes(), to.as_bytes(), &mut b);
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
        // PORT NOTE: erase `self` to a raw ptr so the `defer!` doesn't pin a
        // unique borrow for the rest of the fn (Zig `defer` had no aliasing).
        let self_ptr: *mut Self = self;
        // SAFETY: `self_ptr` points to `*self`, live for the fn body.
        scopeguard::defer! { unsafe { (*self_ptr).emit_memory_visualizer_message_if_needed() } };
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

    #[inline]
    fn timer_heap(&self) -> &mut crate::timer::All {
        crate::jsc_hooks::timer_all_mut()
    }

    pub fn emit_memory_visualizer_message_timer(
        timer: &mut EventLoopTimer,
        _: &bun_core::Timespec,
    ) {
        if !cfg!(feature = "bake_debugging_features") {
            return;
        }
        // SAFETY: timer is the .memory_visualizer_timer field of DevServer
        let dev: &mut DevServer = unsafe { &mut *DevServer::from_timer_ptr(timer) };
        debug_assert!(dev.magic == Magic::Valid);
        dev.emit_memory_visualizer_message();
        timer.state = bun_event_loop::EventLoopTimer::State::FIRED;
        dev.timer_heap().insert(timer);
    }

    pub fn emit_memory_visualizer_message_if_needed(&mut self) {
        if !cfg!(feature = "bake_debugging_features") {
            return;
        }
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

    pub fn write_memory_visualizer_message(
        &self,
        payload: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        let cost = self.memory_cost_detailed();
        let system_total = crate::node::os::totalmem();
        // Wire format: 10 contiguous native-endian u32s — the Zig side declared
        // a packed `Fields` struct, but a `[u32; 10]` has the identical layout
        // (no padding) and is `bytemuck::Pod`, so the byte view is safe.
        let fields: [u32; 10] = [
            /* incremental_graph_client */ cost.incremental_graph_client as u32,
            /* incremental_graph_server */ cost.incremental_graph_server as u32,
            /* js_code */ cost.js_code as u32,
            /* source_maps */ cost.source_maps as u32,
            /* assets */ cost.assets as u32,
            /* other */ cost.other as u32,
            // PORT NOTE: Zig populated this from a debug allocation-scope
            // tracker; Rust ownership has no equivalent runtime counter.
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

    pub fn write_visualizer_message(&self, payload: &mut Vec<u8>) -> Result<(), bun_core::Error> {
        payload.push(MessageId::Visualizer.char());
        // PERF(port): was assume_capacity

        // TODO(port): inline for over [2]bake.Side + .{client_graph, server_graph} — unrolled
        macro_rules! emit_files {
            ($side:expr, $g:expr) => {{
                let g = $g;
                payload.extend_from_slice(
                    &u32::try_from(g.bundled_files.len())
                        .expect("int cast")
                        .to_le_bytes(),
                );
                for (i, (k, v)) in g
                    .bundled_files
                    .keys()
                    .iter()
                    .zip(g.bundled_files.values())
                    .enumerate()
                {
                    // PORT NOTE: un-gated `incremental_graph::File` is unpacked already.
                    let file = v;
                    let mut buf = paths::path_buffer_pool::get();
                    let normalized_key = self.relative_path(&mut *buf, k);
                    payload.extend_from_slice(
                        &u32::try_from(normalized_key.len())
                            .expect("int cast")
                            .to_le_bytes(),
                    );
                    if k.is_empty() {
                        continue;
                    }
                    payload.extend_from_slice(normalized_key);
                    payload.push(
                        (g.stale_files.is_set_allow_out_of_bound(i, true) || file.failed) as u8,
                    );
                    payload.push(($side == bake::Side::Server && file.is_rsc) as u8);
                    payload.push(($side == bake::Side::Server && file.is_ssr) as u8);
                    payload.push(match $side {
                        bake::Side::Server => file.is_route,
                        bake::Side::Client => file.html_route_bundle_index.is_some(),
                    } as u8);
                    payload.push(
                        ($side == bake::Side::Client && file.is_special_framework_file) as u8,
                    );
                    payload.push(match $side {
                        bake::Side::Server => file.is_client_component_boundary,
                        bake::Side::Client => file.is_hmr_root,
                    } as u8);
                }
            }};
        }
        emit_files!(bake::Side::Client, &self.client_graph);
        emit_files!(bake::Side::Server, &self.server_graph);

        // PORT NOTE: Zig used `inline for` over a `[2]bake.Side` tuple — written
        // out as a small macro to avoid duplicating the per-side body while
        // still monomorphizing on the const-generic graph type.
        macro_rules! emit_edges {
            ($g:expr) => {{
                let g = $g;
                let live = g.edges.len() - g.edges_free_list.len();
                payload.extend_from_slice(&u32::try_from(live).expect("int cast").to_le_bytes());
                let mut emitted = 0usize;
                for (i, edge) in g.edges.iter().enumerate() {
                    if g.edges_free_list
                        .iter()
                        .any(|free| free.get() as usize == i)
                    {
                        continue;
                    }
                    payload.extend_from_slice(&edge.dependency.get().to_le_bytes());
                    payload.extend_from_slice(&edge.imported.get().to_le_bytes());
                    emitted += 1;
                }
                debug_assert_eq!(emitted, live);
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
        R: ResponseLike, // TODO(port): bun_uws::ResponseLike once upstream lands
    {
        debug_assert!(id == 0);

        let dw: Box<HmrSocket> = HmrSocket::new(self, res);
        let dw_ptr: *mut HmrSocket = bun_core::heap::into_raw(dw);
        self.active_websocket_connections
            .put_no_clobber(dw_ptr, ())
            .expect("oom");
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
pub use crate::bake::dev_server::{ConsoleLogKind, HmrTopic, IncomingMessageId, MessageId};

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
        pub safe fn BakeGetDefaultExportFromModule(
            global: &JSGlobalObject,
            module: JSValue,
        ) -> JSValue;
    }

    pub fn bake_load_server_hmr_patch(
        global: &JSGlobalObject,
        code: BunString,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            safe fn BakeLoadServerHmrPatch(global: &JSGlobalObject, code: BunString) -> JSValue;
        }
        jsc::from_js_host_call(global, || BakeLoadServerHmrPatch(global, code))
    }

    pub fn bake_load_server_hmr_patch_with_source_map(
        global: &JSGlobalObject,
        code: BunString,
        source_map_json_ptr: *const u8,
        source_map_json_len: usize,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            // PRECONDITION: `ptr` must be readable for `len` bytes and point to
            // a heap allocation whose ownership transfers to the C++
            // `DevServerSourceProvider` (caller wraps the backing `Vec<u8>` in
            // `ManuallyDrop`). Cannot be `safe fn` — raw ptr+len pair carries a
            // caller-side validity + ownership precondition.
            fn BakeLoadServerHmrPatchWithSourceMap(
                global: *const JSGlobalObject,
                code: BunString,
                ptr: *const u8,
                len: usize,
            ) -> JSValue;
        }
        // SAFETY: `global` is live; `source_map_json_ptr`/`len` are forwarded from
        // the sole caller's `ManuallyDrop<Vec<u8>>` (valid for `len`, ownership
        // ceded to C++) — discharges the ptr+len precondition above.
        jsc::from_js_host_call(global, || unsafe {
            BakeLoadServerHmrPatchWithSourceMap(
                global,
                code,
                source_map_json_ptr,
                source_map_json_len,
            )
        })
    }

    pub fn bake_load_initial_server_code(
        global: &JSGlobalObject,
        code: BunString,
        separate_ssr_graph: bool,
    ) -> JsResult<JSValue> {
        unsafe extern "C" {
            safe fn BakeLoadInitialServerCode(
                global: &JSGlobalObject,
                code: BunString,
                separate_ssr_graph: bool,
            ) -> JSValue;
        }
        jsc::from_js_host_call(global, || {
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

    /// SAFETY: returns `&mut BunFrontendDevServerAgent` derived through the
    /// `UnsafeCell` on `Debugger.frontend_dev_server_agent`; two calls alias
    /// the same agent. Caller must not hold another live `&mut` to it.
    /// JS-thread only.
    pub unsafe fn inspector(&self) -> Option<&mut BunFrontendDevServerAgent> {
        if let Some(debugger) = self.vm().debugger.as_ref() {
            bun_core::hint::cold();
            // SAFETY: `frontend_dev_server_agent` is `UnsafeCell`-wrapped for
            // interior mutability (Zig spec returns `*Agent` from `*const
            // DevServer`). JS-thread only; caller upholds the no-alias
            // contract documented above.
            let agent = unsafe { &mut *debugger.frontend_dev_server_agent.get() };
            if agent.is_enabled() {
                bun_core::hint::cold();
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
        watchlist: &bun_watcher::ItemList,
    ) {
        debug_assert!(self.magic == Magic::Valid);
        debug_log!("onFileUpdate start");
        scopeguard::defer! { debug_log!("onFileUpdate end") };

        let mut slice = watchlist.slice();
        // PORT NOTE: SoA columns are disjoint, but `items_mut` borrows the whole
        // slice mutably. Erase each column to a raw `*mut [T]` and reborrow at
        // the use sites — the columns never alias (per `MultiArrayElement` layout).
        let file_paths: *const [std::borrow::Cow<'static, [u8]>] = slice.items_file_path();
        // SAFETY: column 4 (`Count`) is `u32` per `WatchItemField`.
        let counts: *mut [u32] = unsafe { slice.items_mut::<"count", u32>() };
        let kinds: *const [bun_watcher::Kind] = slice.items_kind();
        // SAFETY: `file_paths`/`kinds`/`counts` point to disjoint SoA columns owned
        // by `watchlist`, which outlives this fn; reborrow as slices for indexing.
        let file_paths = unsafe { &*file_paths };
        let counts = unsafe { &mut *counts };
        let kinds = unsafe { &*kinds };

        let ev_ptr = self.watcher_atomics.watcher_acquire_event();
        // SAFETY: `watcher_acquire_event` returns a valid `*mut HotReloadEvent`
        // into `self.watcher_atomics.events`; exclusive on the watcher thread.
        let ev = unsafe { &mut *ev_ptr };
        // PORT NOTE: erase `self` to a raw ptr in the deferred closures so the
        // loop body can keep using `self.bun_watcher` (Zig `defer` had no
        // aliasing check).
        let self_ptr: *mut Self = self;
        // SAFETY: `self_ptr` is live for the entire fn body; guards run at scope exit.
        scopeguard::defer! {
            unsafe { (*self_ptr).watcher_atomics.watcher_release_and_submit_event(ev_ptr) }
        };

        // SAFETY: see `self_ptr` SAFETY above.
        scopeguard::defer! { unsafe { (*self_ptr).bun_watcher.flush_evictions() } };

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
                match kind {
                    bun_watcher::Kind::File => "file",
                    bun_watcher::Kind::Directory => "directory",
                },
                bstr::BStr::new(file_path),
                event.op
            );

            match kind {
                bun_watcher::Kind::File => {
                    if event.op.contains(bun_watcher::Op::DELETE)
                        || event.op.contains(bun_watcher::Op::RENAME)
                    {
                        // TODO: audit this line heavily
                        self.bun_watcher.remove_at_index(
                            bun_watcher::Kind::File,
                            event.index,
                            0,
                            &[],
                        );
                    }

                    ev.append_file(file_path);
                }
                bun_watcher::Kind::Directory => {
                    // PORT NOTE: Zig's `Environment.isLinux` is `os.tag == .linux`,
                    // which is *true* on Android (Zig encodes Android via the ABI
                    // tag, not the OS tag). Rust's `target_os = "linux"` is false
                    // on Android, so include `target_os = "android"` explicitly to
                    // keep forwarding inotify sub-path names there.
                    #[cfg(any(target_os = "linux", target_os = "android"))]
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
                    #[cfg(not(any(target_os = "linux", target_os = "android")))]
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
            // PORT NOTE: split out path before moving `err` into `Output::err`.
            let path = err.path.clone();
            Output::err(
                err,
                "failed to watch {} for hot-reloading",
                (bun_core::fmt::quote(&path),),
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

impl DevServer {
    /// Interface function for FrameworkRouter
    pub fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: framework_router::RouteIndex,
        file_kind: framework_router::FileKind,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        let index = self
            .server_graph
            .insert_stale_extra(abs_path, false, true)
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

impl framework_router::InsertionHandler for DevServer {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        associated_route: framework_router::RouteIndex,
        kind: framework_router::FileKind,
    ) -> Result<OpaqueFileId, AllocError> {
        DevServer::get_file_id_for_router(self, abs_path, associated_route, kind)
            .map_err(|_| AllocError)
    }
    fn on_router_syntax_error(
        &mut self,
        rel_path: &[u8],
        fail: framework_router::TinyLog,
    ) -> Result<(), AllocError> {
        DevServer::on_router_syntax_error(self, rel_path, fail)
    }
    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        file_kind: framework_router::FileKind,
    ) -> Result<(), AllocError> {
        DevServer::on_router_collision_error(self, rel_path, other_id, file_kind)
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
    incremental_graph::FileIndex::<SIDE>::init(u32::try_from(id.get()).expect("int cast"))
}

impl DevServer {
    /// Returns posix style path, suitible for URLs and reproducible hashes.
    /// The caller must provide a PathBuffer from the pool.
    pub fn relative_path<'a>(
        &self,
        relative_path_buf: &'a mut PathBuffer,
        path: &'a [u8],
    ) -> &'a [u8] {
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

        // `relative_platform_buf` with ALWAYS_COPY=true writes into
        // `relative_path_buf[..len]` (same invariant `relative_buf_z` relies
        // on); capture the length, drop the shared borrow, then re-slice
        // mutably to convert separators in place.
        let rel_len = bun_paths::resolve_path::relative_platform_buf::<
            bun_paths::resolve_path::platform::Auto,
            true,
        >(&mut relative_path_buf[..], &self.root, path)
        .len();
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(
            &mut relative_path_buf[..rel_len],
        );
        &relative_path_buf[..rel_len]
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
    let mut filepath_buf = [0u8; if 4096 < MAX_PATH_BYTES {
        4096
    } else {
        MAX_PATH_BYTES
    }];
    let filepath = {
        let mut cursor = &mut filepath_buf[..];
        let _ = write!(
            cursor,
            "incremental-graph-crash-dump.{}.html\0",
            bun_core::time::timestamp()
        );
        bun_core::slice_to_nul(&filepath_buf)
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
        let n = bun_base64::encode(&mut buf, chunk);
        file.write_all(&buf[..n])?;
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
pub struct RouteIndexAndRecurseFlag(pub u32);
impl RouteIndexAndRecurseFlag {
    pub fn new(
        route_index: framework_router::RouteIndex,
        should_recurse_when_visiting: bool,
    ) -> Self {
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
#[derive(Default)]
pub struct EntryPointList {
    pub set: bun_collections::StringArrayHashMap<entry_point_list::Flags>,
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
    pub fn empty() -> EntryPointList {
        EntryPointList::default()
    }

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
        self.append(
            abs_path,
            entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS,
        )
    }

    /// Deduplictes requests to bundle the same file twice.
    pub fn append(
        &mut self,
        abs_path: &[u8],
        flags: entry_point_list::Flags,
    ) -> Result<(), bun_core::Error> {
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
/// Zig stores `*HTMLBundle.HTMLBundleRoute` (BACKREF — DevServer.zig:4364);
/// `<'a>` retained only for the owning `DevServer<'a>`'s `Transpiler` borrows.
#[derive(Default)]
pub struct HTMLRouter {
    pub map: StringHashMap<*mut HTMLBundleRoute>,
    /// If a catch-all route exists, it is not stored in map, but here.
    pub fallback: Option<*mut HTMLBundleRoute>,
}

impl HTMLRouter {
    pub fn empty() -> HTMLRouter {
        HTMLRouter {
            map: StringHashMap::new(),
            fallback: None,
        }
    }

    pub fn get(&self, path: &[u8]) -> Option<*mut HTMLBundleRoute> {
        self.map.get(path).copied().or(self.fallback)
    }

    pub fn put(&mut self, path: &[u8], route: *mut HTMLBundleRoute) -> Result<(), bun_core::Error> {
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
        path: &bun_bundler::bun_fs::Path<'_>,
        contents: crate::webcore::blob::Any,
        content_hash: u64,
    ) -> Result<(), bun_core::Error> {
        let _g = self.graph_safety_lock.guard();
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
        self.bundler_options.plugin = plugins.and_then(::core::ptr::NonNull::new);
        self.plugin_state = PluginState::Loaded;
        self.start_next_bundle_if_present();
        Ok(())
    }

    pub fn on_plugins_rejected(&mut self) -> Result<(), bun_core::Error> {
        self.plugin_state = PluginState::Err;
        while let Some(item) = self.next_bundle.requests.pop_first() {
            // SAFETY: `pop_first` returns a valid `*mut Node<DeferredRequest>`;
            // `data` was initialized by `defer_request`.
            unsafe {
                let d = (*item).data.assume_init_mut();
                d.abort();
                d.deref_();
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
    // bound on `BodyReaderHandler` that a borrowed `&mut DevServer` would violate.
    dev: *mut DevServer,
    body: uws::BodyReaderMixin<Self>, // TODO(port): BodyReaderMixin(@This(), "body", runWithBody, finalize)
}

bun_core::intrusive_field!(UnrefSourceMapRequest, body: uws::BodyReaderMixin<UnrefSourceMapRequest>);
impl bun_uws_sys::body_reader_mixin::BodyReaderHandler for UnrefSourceMapRequest {
    unsafe fn on_body(
        this: *mut Self,
        body: &[u8],
        resp: AnyResponse,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: caller (BodyReaderMixin) passes the original heap-allocated
        // pointer with full-allocation provenance and no live borrows.
        unsafe { Self::run_with_body(this, body, resp) }
    }
    unsafe fn on_error(this: *mut Self) {
        // SAFETY: caller passes the original heap-allocated pointer; finalize
        // consumes it via heap::take exactly once.
        unsafe { Self::finalize(this) }
    }
}

impl UnrefSourceMapRequest {
    fn run<R>(dev: &mut DevServer, _: &mut Request, resp: &mut R)
    where
        R: bun_uws_sys::body_reader_mixin::BodyResponse,
    {
        dev.server
            .as_mut()
            .expect("server bound")
            .on_pending_request();
        let ctx = Box::new(UnrefSourceMapRequest {
            dev: std::ptr::from_mut::<DevServer>(dev),
            body: uws::BodyReaderMixin::init(),
        });
        let raw = bun_core::heap::into_raw(ctx);
        uws::BodyReaderMixin::<Self>::read_body(raw, resp);
    }

    /// SAFETY: `ctx` must be the pointer returned by `heap::alloc` in `run`;
    /// called exactly once.
    unsafe fn finalize(ctx: *mut UnrefSourceMapRequest) {
        // SAFETY: caller contract — ctx is the original Box allocation; no
        // live borrow of *ctx exists.
        let ctx = unsafe { bun_core::heap::take(ctx) };
        // SAFETY: dev outlives the request
        unsafe {
            (*ctx.dev)
                .server
                .as_mut()
                .unwrap()
                .on_static_request_complete()
        };
        drop(ctx);
    }

    /// SAFETY: `ctx` must be the pointer returned by `heap::alloc` in `run`.
    /// On `Ok` this consumes `ctx` via `finalize`; on `Err` ownership stays
    /// with the caller (BodyReaderMixin → `on_error`).
    unsafe fn run_with_body(
        ctx: *mut UnrefSourceMapRequest,
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
        // SAFETY: ctx is live (caller contract); dev outlives the request.
        let _ = unsafe { &mut *(*ctx).dev }
            .source_maps
            .remove_or_upgrade_weak_ref(
                source_map_key,
                source_map_store::RemoveOrUpgradeMode::Remove,
            );
        r.write_status(b"204 No Content");
        r.end(b"", false);
        // SAFETY: ctx is the original heap-allocated pointer; the only borrow
        // derived from it points into a separate DevServer allocation and has
        // ended.
        unsafe { Self::finalize(ctx) };
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

#[derive(Default)]
pub struct TestingBatch {
    /// Keys are borrowed. See doc comment in Zig source.
    pub entry_points: EntryPointList,
}

impl TestingBatch {
    pub fn empty() -> TestingBatch {
        TestingBatch {
            entry_points: EntryPointList::empty(),
        }
    }

    pub fn append(&mut self, entry_points: &EntryPointList) -> Result<(), bun_core::Error> {
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
pub fn get_deinit_count_for_testing() -> usize {
    DEV_SERVER_DEINIT_COUNT_FOR_TESTING.load(::core::sync::atomic::Ordering::Relaxed)
}

struct PromiseEnsureRouteBundledCtx<'a> {
    // PORT NOTE: raw ptr — the Zig code freely re-borrowed `dev` across the ctx
    // while also passing `&mut dev` into `ensure_route_is_bundled`.
    dev: *mut DevServer,
    global: &'a JSGlobalObject,
    promise: Option<jsc::JSPromiseStrong>,
    p: Option<*mut jsc::JSPromise>, // BORROW_FIELD: from sibling self.promise
    already_loaded: bool,
    route_bundle_index: route_bundle::Index,
}

impl<'a> PromiseEnsureRouteBundledCtx<'a> {
    /// Reborrow the erased `dev` pointer.
    /// SAFETY: `self.dev` is set from a live `&mut DevServer` at ctx
    /// construction; the ctx is stack-local in the request handler scope.
    #[inline]
    fn dev_mut(&mut self) -> &mut DevServer {
        unsafe { &mut *self.dev }
    }

    /// Reborrow the GC-heap `JSPromise` recorded in `self.p`. Single `unsafe`
    /// site for the set-once `p: Option<*mut JSPromise>` self-borrow field;
    /// callers (`on_loaded` / `on_plugin_error` / the `to_js()` epilogue in
    /// `js_get_route_bundle_promise`) reach this only after `ensure_promise`
    /// or `on_defer` has populated `p`.
    #[inline]
    fn promise_mut(&mut self) -> &mut jsc::JSPromise {
        // SAFETY: `p` is `Some(strong.get())` after `ensure_promise`/`on_defer`;
        // the JSPromise GC cell is rooted for the lifetime of `self` by either
        // `self.promise: JSPromiseStrong` or the bundle's `promise.strong`
        // (`current_bundle`/`next_bundle`), so the pointee outlives the borrow.
        unsafe { &mut *self.p.expect("infallible: promise bound") }
    }

    fn ensure_promise(&mut self) -> jsc::JSPromiseStrong {
        if self.promise.is_none() {
            let strong = jsc::JSPromiseStrong::init(self.global);
            self.p = Some(std::ptr::from_mut(strong.get()));
            self.promise = Some(strong);
        }
        // PORT NOTE: Zig returned the `Strong` by bitwise copy (shared
        // HandleSlot). Rust `Strong` owns its slot, so allocate a second
        // handle to the same JSPromise instead — both `self.promise` and the
        // returned value root the same cell.
        let value = self.promise.as_ref().unwrap().value();
        jsc::JSPromiseStrong::from_value(value, self.global)
    }

    fn on_defer(&mut self, bundle_field: BundleQueueType) -> JsResult<()> {
        let route_bundle_index = self.route_bundle_index;
        match bundle_field {
            BundleQueueType::CurrentBundle => {
                let cb = self
                    .dev_mut()
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active");
                if cb.promise.strong.has_value() {
                    cb.promise
                        .route_bundle_indices
                        .put(route_bundle_index, ())
                        .expect("oom");
                    self.p = Some(cb.promise.strong.get());
                    return Ok(());
                }
                let strong_promise = self.ensure_promise();
                let cb = self
                    .dev_mut()
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active");
                cb.promise
                    .route_bundle_indices
                    .put(route_bundle_index, ())
                    .expect("oom");
                cb.promise.strong = strong_promise;
                Ok(())
            }
            BundleQueueType::NextBundle => {
                if self.dev_mut().next_bundle.promise.strong.has_value() {
                    self.dev_mut()
                        .next_bundle
                        .promise
                        .route_bundle_indices
                        .put(route_bundle_index, ())
                        .expect("oom");
                    self.p = Some(self.dev_mut().next_bundle.promise.strong.get());
                    return Ok(());
                }
                let strong_promise = self.ensure_promise();
                self.dev_mut()
                    .next_bundle
                    .promise
                    .route_bundle_indices
                    .put(route_bundle_index, ())
                    .expect("oom");
                self.dev_mut().next_bundle.promise.strong = strong_promise;
                Ok(())
            }
        }
    }

    fn on_loaded(&mut self) -> JsResult<()> {
        let _ = self.ensure_promise();
        let global = self.global;
        self.promise_mut().resolve(global, JSValue::TRUE)?;
        // SAFETY: dev.vm is JSC_BORROW — valid for DevServer lifetime
        self.dev_mut().vm_mut().drain_microtasks();
        Ok(())
    }

    fn on_failure(&mut self) -> JsResult<()> {
        let promise_response = PromiseResponse {
            promise: self.ensure_promise(),
            global: self.global,
        };

        // PORT NOTE: split the route-bundle borrow off via raw pointer so the
        // failure slice doesn't conflict with the `&mut DevServer` below.
        let route_bundle_index = self.route_bundle_index;
        let failure = std::ptr::from_ref::<SerializedFailure>(
            self.dev_mut()
                .route_bundle_ptr(route_bundle_index)
                .data
                .framework()
                .evaluate_failure
                .as_ref()
                .unwrap(),
        );
        // SAFETY: `failure` points into `route_bundles[i].data` which is not
        // mutated by `send_serialized_failures`.
        let failures = ::core::slice::from_ref(unsafe { &*failure });
        self.dev_mut().send_serialized_failures(
            DevResponse::Promise(promise_response),
            failures,
            ErrorPageKind::Evaluation,
            None,
        )?;
        Ok(())
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        let _ = self.ensure_promise();
        let global = self.global;
        self.promise_mut()
            .reject(global, BunString::static_("Plugin error").to_js(global))?;
        // SAFETY: dev.vm is JSC_BORROW — valid for DevServer lifetime
        self.dev_mut().vm_mut().drain_microtasks();
        Ok(())
    }

    fn to_dev_response(&mut self) -> DevResponse<'_> {
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
    fn to_dev_response(&mut self) -> DevResponse<'_> {
        PromiseEnsureRouteBundledCtx::to_dev_response(self)
    }
    fn dev(&mut self) -> &mut DevServer {
        self.dev_mut()
    }
    fn route_bundle_index(&self) -> route_bundle::Index {
        self.route_bundle_index
    }
}

// C++ side declares `extern "C" SYSV_ABI` (BakeAdditionsToGlobalObject.cpp).
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bake__bundleNewRouteJSFunctionImpl(
        global: &JSGlobalObject,
        request_ptr: *mut c_void,
        url: BunString,
    ) -> JSValue {
        jsc::to_js_host_call(global, || bundle_new_route_js_function_impl(global, request_ptr, url))
    }
}

fn bundle_new_route_js_function_impl(
    global: &JSGlobalObject,
    request_ptr: *mut c_void,
    url_bunstr: BunString,
) -> JsResult<JSValue> {
    let url = url_bunstr.to_utf8();

    // SAFETY: request_ptr is a *bun.webcore.Request from C++
    let request: &mut WebRequest = unsafe { &mut *request_ptr.cast::<WebRequest>() };
    let Some(dev) = request.request_context.dev_server() else {
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

    let mut params: framework_router::MatchedParams = Default::default();
    let Some(route_index) = dev.router.match_slow(pathname, &mut params) else {
        return Err(global.throw(format_args!(
            "No route found for path: {}",
            bstr::BStr::new(pathname)
        )));
    };

    let _exit = dev.vm().enter_event_loop_scope();

    let _ = dev;
    let Some(dev_ptr) = request.request_context.dev_server_mut() else {
        return Err(global.throw(format_args!(
            "Request context does not belong to dev server"
        )));
    };
    // SAFETY: JS-thread single-writer; `dev_server_mut` returns the
    // `Box<DevServer>` slot in `NewServer` populated by `set_routes`.
    let dev: &mut DevServer = unsafe { &mut *dev_ptr };

    let route_bundle_index = dev
        .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
        .expect("oom");
    let dev_ptr: *mut DevServer = dev;
    let mut ctx = PromiseEnsureRouteBundledCtx {
        dev: dev_ptr,
        global,
        promise: None,
        p: None,
        already_loaded: false,
        route_bundle_index,
    };

    let rbi = ctx.route_bundle_index;
    // SAFETY: `ctx.dev` aliases the same DevServer; Zig passed both freely.
    // Reborrow via raw ptr to satisfy borrowck while ctx is also &mut-borrowed.
    ensure_route_is_bundled(unsafe { &mut *dev_ptr }, rbi, &mut ctx)?;

    let array = JSValue::create_empty_array(global, 2)?;

    array.put_index(global, 0, JSValue::js_number_from_uint64(rbi.get() as u64))?;

    if ctx.p.is_none() {
        array.put_index(global, 1, JSValue::UNDEFINED)?;
        return Ok(array);
    }

    debug_assert!(ctx.p.is_some());
    // Route through the single `promise_mut()` accessor (one audited deref for
    // the set-once `p` field) instead of open-coding the raw deref here.
    array.put_index(global, 1, ctx.promise_mut().to_js())?;

    Ok(array)
}

// TODO(port): move to <area>_sys
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

pub fn create_dev_server_framework_request_args_object(
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

#[bun_jsc::host_fn(export = "Bake__getNewRouteParamsJSFunctionImpl")]
pub fn bake_get_new_route_params_js_function_impl(
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

    let Some(request_ptr) = <WebRequest as bun_jsc::JsClass>::from_js(request_js) else {
        return Err(global.throw(format_args!("Expected a Request object")));
    };
    // SAFETY: `from_js` returned a live native pointer; JS holds the GC ref.
    let request: &mut WebRequest = unsafe { &mut *request_ptr };
    let Some(dev_ptr) = request.request_context.dev_server_mut() else {
        return Err(global.throw(format_args!(
            "Request context does not belong to dev server"
        )));
    };
    // SAFETY: JS-thread single-writer; `dev_server_mut` returns the
    // `Box<DevServer>` slot in `NewServer` populated by `set_routes`.
    let dev: &mut DevServer = unsafe { &mut *dev_ptr };

    let route_bundle_index = route_bundle::Index::init(
        u32::try_from(route_bundle_index_js.to_int32()).expect("int cast"),
    );

    let url = OwnedString::new(url_js.to_bun_string(global)?);
    let url_utf8 = url.to_utf8();

    new_route_params_for_bundle_promise(dev, route_bundle_index, url_utf8.slice())
}

fn new_route_params_for_bundle_promise(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    url: &[u8],
) -> JsResult<JSValue> {
    // PORT NOTE: erase `dev` so the `route_bundle` / `framework_bundle`
    // borrows don't conflict with `dev.router` / `dev.compute_arguments_...`
    // (Zig held these as plain heap pointers).
    let dev_ptr = std::ptr::from_mut::<DevServer>(dev);
    // SAFETY: `dev_ptr` accesses below touch disjoint fields of `*dev`.
    let route_bundle = unsafe { &mut *dev_ptr }.route_bundle_ptr(route_bundle_index);
    let framework_bundle = match &mut route_bundle.data {
        route_bundle::Data::Framework(f) => f,
        _ => unreachable!(),
    };

    let pathname = extract_pathname_from_url(url);

    let global = dev.global();
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

    // SAFETY: `dev_ptr` is live; `framework_bundle` points into
    // `(*dev_ptr).route_bundles[route_bundle_index].data`. Raw-ptr receiver —
    // see PORT NOTE on `compute_arguments_for_framework_request`.
    let args = unsafe {
        DevServer::compute_arguments_for_framework_request(
            dev_ptr,
            route_bundle_index,
            framework_bundle,
            params_js_value,
            false,
        )
    }?;

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
type BunFrontendDevServerAgent = jsc::debugger::BunFrontendDevServerAgent;

// ported from: src/bake/DevServer.zig
