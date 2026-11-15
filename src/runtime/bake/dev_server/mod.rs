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

use ::core::cell::{Cell, RefCell, RefMut};
use ::core::ffi::c_void;
use ::core::pin::Pin;
use bun_bundler::mal_prelude::*;
use std::io::Write as _;
use std::sync::Arc;
use std::time::Instant;

use bun_alloc::{AllocError, Arena};
use bun_ast::Log;
use bun_bundler::options_impl::TargetExt as _;
use bun_collections::{ArrayHashMap, DynamicBitSet, HashMap, HiveArrayFallback, StringHashMap};
use bun_core::{self as str, String as BunString, ZStr, strings};
use bun_core::{Environment, Output, Timespec, TimespecMockMode};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
use bun_jsc::{LogJsc as _, StringJsc as _};
use bun_paths::{self as paths, PathBuffer};
use bun_sys as sys;
use bun_uws::{self as uws, AnyResponse, Opcode, Request, WebSocketUpgradeContext};
use bun_watcher::WatchItemColumns as _;
use bun_wyhash::{Wyhash, hash};

use crate::api::server::StaticRoute;
use crate::api::{AnyServer, SavedRequest};
use crate::bake;
use crate::bake::router::{self, FrameworkRouter, OpaqueFileId};
use crate::server::PendingRequest;
use crate::server::html_bundle::HTMLBundleRoute;
use bun_ast::Loader;
use bun_bundler::{self as bundler, BundleV2, Transpiler};
use bun_http::{Method, MimeType};
use bun_watcher::Watcher;

pub(super) use self::assets::Assets;
pub(super) use self::error_report_request::ErrorReportRequest;

pub(super) use self::incremental_graph::{Graphs, IncrementalGraph};
pub(super) use self::memory_cost::MemoryCost;

bun_output::declare_scope!(DevServer, visible);
bun_output::declare_scope!(SourceMapStore, visible);

bun_output::define_scoped_log!(debug_log, crate::bake::dev_server::DevServer);
bun_output::define_scoped_log!(map_log, crate::bake::dev_server::SourceMapStore);

use core::sync::atomic::Ordering;

use bun_collections::StringArrayHashMap;

use super::{Graph, Side};

// ─── submodules ──────────────────────────────────────────────────────────────
mod bundle;
mod bundler_vtable;
pub(crate) mod deferred_request;
pub(crate) mod directory_watch_store;
mod ensure_route;
pub(crate) mod error_report_request;
mod failures;
mod finalize;
pub(crate) mod hmr_socket;
mod hot_reload_event;
mod http;
mod js_escape;
mod lifecycle;
pub(crate) mod memory_cost;
mod protocol;
mod render;
mod router_glue;
mod server_hmr_ffi;
mod trace;
mod watch;

pub(super) use crate::server::SavedRequestUnion;
pub(crate) use bundle::EntryPointList;
use bundle::{RouteIndexAndRecurseFlag, TestingBatch};
use deferred_request::{DeferredScriptRequest, Handler, ResponseAndMethod};
pub(crate) use directory_watch_store::DirectoryWatchStore;
use ensure_route::{
    BundleQueueType, HTMLRouter, ReqOrSaved, RequestEnsureRouteBundledCtx, ensure_route_is_bundled,
    trace_route_failures,
};
use failures::mark_all_route_children;
pub(crate) use finalize::{CachedFileIndex, HotUpdateContext};
use hmr_socket::hmr_socket_behavior;
pub(crate) use hot_reload_event::{HotReloadEvent, PendingReloadEvent};
use http::{
    DevHandlerId, dev_route_tramp, extract_pathname_from_url, host_forbidden,
    is_allowed_dev_origin, on_outdated_js_corked, origin_forbidden,
};
pub(crate) use http::{is_allowed_dev_host, is_allowed_host_header};
use lifecycle::Transpilers;
pub(crate) use lifecycle::{OwnedDevServer, init};
pub(crate) use protocol::{ConsoleLogKind, HmrTopic, HmrTopicBits, IncomingMessageId, MessageId};
use render::FrameworkRequest;
use router_glue::{OpaqueFileIdOrOptional, from_opaque_file_id, relative_path, to_opaque_file_id};

/// `DevServer.FileKind` — kept in lockstep with `bun_bundler::bake_types::CacheKind`
/// (the vtable boundary maps between them via an exhaustive match).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum FileKind {
    Unknown = 0,
    Js = 1,
    Asset = 2,
    Css = 3,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum ChunkKind {
    InitialResponse = 0,
    HmrChunk = 1,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum TraceImportGoal {
    FindCss,
    FindClientModules,
    FindErrors,
}

// ──────────────────────────────────────────────────────────────────────────
// EventLoopTimer
// ──────────────────────────────────────────────────────────────────────────
use bun_event_loop::EventLoopTimer::{OwnedTimer, Tag as TimerTag, TimerRef};

/// Boxed: a `&mut DevServerState` could move a timer that is armed.
pub(crate) struct DevServerTimers {
    pub(crate) dev: *const DevServer,
    memory_visualizer_timer: OwnedTimer<{ TimerTag::DevServerMemoryVisualizerTick }>,
    weak_ref_sweep_timer: OwnedTimer<{ TimerTag::DevServerSweepSourceMaps }>,
}

bun_event_loop::impl_timer_owner!(DevServerTimers;
    memory_visualizer_timer: OwnedTimer<DevServerMemoryVisualizerTick>,
    weak_ref_sweep_timer: OwnedTimer<DevServerSweepSourceMaps>,
);

impl DevServerTimers {
    fn arm_memory_visualizer_timer(self: Pin<&Self>) {
        let timer = TimerRef::from_pin::<{ TimerTag::DevServerMemoryVisualizerTick }, _>(self);
        let next = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, 1000);
        crate::jsc_hooks::timer_all().update(timer, &next);
    }

    fn arm_weak_ref_sweep_timer(self: Pin<&Self>, next: &Timespec) {
        let timer = TimerRef::from_pin::<{ TimerTag::DevServerSweepSourceMaps }, _>(self);
        crate::jsc_hooks::timer_all().update(timer, next);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IncrementalResult / GraphTraceState
// ──────────────────────────────────────────────────────────────────────────
pub(crate) struct IncrementalResult {
    pub(crate) framework_routes_affected: Vec<RouteIndexAndRecurseFlag>,
    pub(crate) html_routes_soft_affected: Vec<route_bundle::Index>,
    pub(crate) html_routes_hard_affected: Vec<route_bundle::Index>,
    pub(crate) had_adjusted_edges: bool,
    pub(crate) client_components_added: Vec<incremental_graph::ServerFileIndex>,
    pub(crate) client_components_removed: Vec<incremental_graph::ServerFileIndex>,
    pub(crate) failures_removed: Vec<SerializedFailure>,
    pub(crate) client_components_affected: Vec<incremental_graph::ServerFileIndex>,
    pub(crate) failures_added: Vec<SerializedFailure>,
}
impl IncrementalResult {
    pub(crate) const EMPTY: IncrementalResult = IncrementalResult {
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

    /// Clears each list retaining capacity, asserts `failures_removed` was
    /// already drained, and intentionally leaves `had_adjusted_edges`
    /// untouched.
    pub(crate) fn reset(&mut self) {
        self.framework_routes_affected.clear();
        self.html_routes_soft_affected.clear();
        self.html_routes_hard_affected.clear();
        self.client_components_added.clear();
        self.client_components_removed.clear();
        debug_assert!(self.failures_removed.is_empty());
        self.failures_removed.clear();
        self.client_components_affected.clear();
        self.failures_added.clear();
        // NOTE: `had_adjusted_edges` is NOT reset here (matches spec).
    }
}

pub(crate) struct GraphTraceState {
    pub(crate) client_bits: DynamicBitSet,
    pub(crate) server_bits: DynamicBitSet,
    /// Filled by `TraceImportGoal::FindErrors`.
    pub(crate) failures: Vec<SerializedFailure>,
}
impl GraphTraceState {
    #[inline]
    pub(crate) fn bits(&mut self, side: Side) -> &mut DynamicBitSet {
        match side {
            Side::Client => &mut self.client_bits,
            Side::Server => &mut self.server_bits,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.server_bits.set_all(false);
        self.client_bits.set_all(false);
        self.failures.clear();
    }

    pub(crate) fn resize(&mut self, side: Side, new_size: usize) -> Result<(), crate::Error> {
        let b = self.bits(side);
        if b.bit_length() < new_size {
            b.resize(new_size, false)?;
        }
        Ok(())
    }

    pub(crate) fn clear_and_free(&mut self) {
        self.client_bits
            .resize(0, false)
            .expect("freeing memory can not fail");
        self.server_bits
            .resize(0, false)
            .expect("freeing memory can not fail");
        self.failures = Vec::new();
    }
}

pub(crate) mod assets;
pub(crate) mod incremental_graph;
pub(crate) mod inspector_agent;
pub(crate) mod packed_map;
pub(crate) mod route_bundle;
pub(crate) mod serialized_failure;
pub(crate) mod source_map_store;

pub(crate) use serialized_failure::SerializedFailure;

/// Local response trait — the response type is a generic bound.
/// Method shapes mirror `bun_uws_sys::Response<SSL>` so the `R`-generic
/// bodies type-check. `bun_uws` exposes no equivalent trait; if it ever
/// grows one, this can be replaced by it.
pub(crate) trait ResponseLike {
    fn write_status(&mut self, status: &[u8]);
    fn end(&mut self, data: &[u8], close_connection: bool);
    fn as_any_response(&mut self) -> bun_uws::AnyResponse;
}

// `AnyResponse` already type-erases SSL/TCP/H3 — it satisfies `resp: anytype`
// trivially. The trait methods take `&mut self` (matching `Response<SSL>`'s
// shape); `AnyResponse` is `Copy`, so the inherent by-value methods are called
// on `*self`.
impl ResponseLike for bun_uws::AnyResponse {
    fn write_status(&mut self, status: &[u8]) {
        (*self).write_status(status)
    }
    fn end(&mut self, data: &[u8], close_connection: bool) {
        (*self).end(data, close_connection)
    }
    fn as_any_response(&mut self) -> bun_uws::AnyResponse {
        *self
    }
}

/// `DevServer.HmrSocket` — per-WebSocket state. Method bodies (open/close/
/// message handlers) live in [`hmr_socket`].
pub(crate) struct HmrSocket {
    pub(crate) underlying: bun_uws::AnyWebSocket,
    pub(crate) subscriptions: crate::bake::dev_server::HmrTopicBits,
    /// By telling DevServer the active route, this enables receiving detailed
    /// `hot_update` events for when the route is updated.
    pub(crate) active_route: route_bundle::IndexOptional,
    /// Source-map keys this socket has been sent; used to ref-count entries
    /// in `SourceMapStore` so they survive until the socket disconnects.
    pub(crate) referenced_source_maps: HashMap<source_map_store::Key, ()>,
    pub(crate) inspector_connection_id: i32,
}

impl HmrSocket {
    /// `subscriptions` is a packed `HmrTopicBits` value; test the bit for a
    /// given topic.
    #[inline]
    pub(crate) fn is_subscribed(&self, topic: HmrTopic) -> bool {
        self.subscriptions.contains(topic.as_bit())
    }
}

impl DevServerState {
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

    /// Panics while a bundle has the transpilers.
    fn server_resolver(&mut self) -> &mut bun_resolver::Resolver<'static> {
        let transpilers = self.transpilers.as_mut().expect("no bundle is running");
        &mut transpilers.server.resolver
    }
}
pub(super) use crate::bake::dev_server::route_bundle::RouteBundle;
pub(super) use crate::bake::dev_server::source_map_store::SourceMapStore;

pub(crate) struct Options<'a> {
    pub server: AnyServer,
    /// Arena must live until DevServer drops
    pub arena: &'a bun_ast::AstArena,
    pub root: &'a ZStr,
    pub vm: &'a VirtualMachine,
    pub framework: bake::Framework,
    pub bundler_options: bake::SplitBundlerOptions,
    pub broadcast_console_log_from_browser_to_server: bool,
}

#[cfg(debug_assertions)]
#[repr(u128)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Magic {
    Valid = 0x1ffd363f121f5c12,
}

#[cfg(not(debug_assertions))]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Magic {
    Valid,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum PluginState {
    /// Should ask server for plugins. Once plugins are loaded, the plugin
    /// pointer is written into `DevServerState.plugins`
    Unknown,
    // These two states mean that `server.getOrLoadPlugins()` was called.
    Pending,
    Loaded,
    /// Currently, this represents a degraded state where no bundle can
    /// be correctly executed because the plugins did not load successfully.
    Err,
}

pub(crate) enum Plugins {
    /// From `Options::bundler_options`.
    Owned(crate::api::js_bundler::OwnedPlugin),
    /// Owned by the server's `ServePlugins`.
    Borrowed(::core::ptr::NonNull<crate::api::js_bundler::Plugin>),
}

impl Plugins {
    fn as_non_null(&self) -> ::core::ptr::NonNull<crate::api::js_bundler::Plugin> {
        match self {
            Plugins::Owned(plugins) => plugins.as_non_null(),
            Plugins::Borrowed(plugins) => *plugins,
        }
    }
}

pub(crate) enum TestingBatchEvents {
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
    /// Released while a bundle ran; `finalize_bundle_cleanup` starts it after.
    ReleaseAfterBundle(TestingBatch),
}

/// There is only ever one bundle executing at the same time, since all bundles
/// inevitably share state. This bundle is asynchronous, storing its state here
/// while in-flight. `pass` holds its allocations.
pub(crate) struct CurrentBundle {
    /// The `BundlePass`: `dyn`, so trimming the bundler takes its drop along. `finish_bundle` takes it.
    pub(crate) pass: Option<Box<dyn ::core::any::Any>>,
    /// Started when the bundle was queued
    pub(crate) timer: Instant,
    /// If any files in this bundle were due to hot-reloading, some extra work
    /// must be done to inform clients to reload routes. When this is false,
    /// all entry points do not have bundles yet.
    pub(crate) had_reload_event: bool,
    /// After a bundle finishes, these requests will be continued, either
    /// calling their handler on success or sending the error page on failure.
    /// Owned by `deferred_request_pool` in DevServer.
    pub(crate) requests: deferred_request::List,
    /// Answered by `finalize_bundle_cleanup`.
    pub(crate) script_requests: Vec<bun_ptr::RefPtr<DeferredScriptRequest>>,
    pub(crate) pending_request: PendingRequest,
}

pub(crate) struct NextBundle {
    /// A list of `RouteBundle`s which have active requests to bundle it.
    pub(crate) route_queue: ArrayHashMap<route_bundle::Index, ()>,
    /// `DevServerState.pending_reload_event` is to be drained.
    pub(crate) has_reload_event: bool,
    /// The list of requests that are blocked on this bundle.
    pub(crate) requests: deferred_request::List,
}

/// What uWS, timers, tasks and the bundler point to. It is only ever borrowed shared.
pub(crate) struct DevServer {
    pub(crate) server: AnyServer,
    state: RefCell<Option<DevServerState>>,
    pending_parse_tasks: Cell<u32>,
    /// Parse tasks use the VM's plugins and loop. Its wait for tickets releases their results, which drops this.
    parse_tasks_ticket: Cell<Option<jsc::Ticket>>,
    deferred_request_pool:
        HiveArrayFallback<deferred_request::Node, { deferred_request::MAX_PREALLOCATED }>,
}

impl DevServer {
    /// Panics while it is borrowed: drop the result before running JavaScript or closing a WebSocket.
    #[track_caller]
    pub(crate) fn state_mut(&self) -> StateGuard<'_> {
        StateGuard {
            state: RefMut::map(self.state.borrow_mut(), |state| {
                state.as_mut().expect("set by `init`")
            }),
            dev_server: self,
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.state_mut().memory_cost()
    }
}

pub(crate) struct StateGuard<'d> {
    state: RefMut<'d, DevServerState>,
    dev_server: &'d DevServer,
}

impl ::core::ops::Deref for StateGuard<'_> {
    type Target = DevServerState;
    fn deref(&self) -> &DevServerState {
        &self.state
    }
}

impl ::core::ops::DerefMut for StateGuard<'_> {
    fn deref_mut(&mut self) -> &mut DevServerState {
        &mut self.state
    }
}

pub(crate) struct DevServerState {
    /// To validate the DevServer has not been collected, this can be checked.
    /// When freed, this is set to `undefined`. UAF here also trips ASAN.
    pub(crate) magic: Magic,
    /// Unique identifier for this DevServer instance. Used to identify it
    /// when using the debugger protocol.
    pub(crate) inspector_server_id: DebuggerId,
    /// Hex string generated by hashing the framework config and bun revision.
    /// Emebedding in client bundles and sent when the HMR Socket is opened;
    /// When the value mismatches the page is forcibly reloaded.
    pub(crate) configuration_hash_key: [u8; 16],
    /// The virtual machine (global object) to execute code in.
    /// JSC_BORROW (LIFETIMES.tsv): passed in via `Options.vm`; deinit no-op.
    /// [`BackRef`](bun_ptr::BackRef) (not `&'a`) so `DevServer` is not
    /// lifetime-generic — it is `Box`-owned by `ServerInstance` which outlives
    /// the VM anyway. The back-reference invariant (pointee outlives holder)
    /// is the JSC_BORROW guarantee: vm is valid for DevServer's entire
    /// lifetime.
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>,
    pub(crate) server: AnyServer,
    /// Contains the tree of routes. This structure contains FileIndex
    pub(crate) router: FrameworkRouter,
    /// Every navigatable route has bundling state here.
    pub(crate) route_bundles: Vec<RouteBundle>,
    pub(crate) graphs: Graphs,
    /// Empty while a bundle has it.
    pub(crate) barrels: bundler::bundle_v2::DevServerBarrels,
    /// This acts as a duplicate of the lookup table in uws, but only for HTML routes
    /// Used to identify what route a connected WebSocket is on, so that only
    /// the active pages are notified of a hot updates.
    pub(crate) html_router: HTMLRouter,
    /// Similar to `Assets`, specialized for the additional needs of source mappings.
    pub(crate) source_maps: SourceMapStore,
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
    pub(crate) bun_watcher: Arc<Watcher>,
    pub(crate) directory_watchers: DirectoryWatchStore,
    pub(crate) pending_reload_event: Arc<PendingReloadEvent>,
    /// Empty. Swapped with the one in `pending_reload_event` to reuse its memory.
    pub(crate) spare_reload_event: HotReloadEvent,
    pub(crate) testing_batch_events: TestingBatchEvents,

    /// Number of bundles that have been executed. This is currently not read, but
    /// will be used later to determine when to invoke graph garbage collection.
    pub(crate) generation: usize,
    /// Displayed in the HMR success indicator
    pub(crate) bundles_since_last_error: usize,

    pub(crate) framework: bake::Framework,
    /// `None` while a bundle has them.
    transpilers: Option<bun_ptr::AliasableBox<Transpilers>>,
    /// The log used by all `transpilers`.
    /// Note that it is rarely correct to write messages into it. Instead, associate
    /// messages with the IncrementalGraph file or Route using `SerializedFailure`
    pub(crate) log: &'static Log,
    pub(crate) plugin_state: PluginState,
    pub(crate) plugins: Option<Plugins>,
    /// See `CurrentBundle` doc comment.
    pub(crate) current_bundle: Option<CurrentBundle>,
    /// When `current_bundle` is non-null and new requests to bundle come in,
    /// those are temporaried here. When the current bundle is finished, it
    /// will immediately enqueue this.
    pub(crate) next_bundle: NextBundle,
    /// UWS can handle closing the websocket connections themselves
    pub(crate) active_websocket_connections: Vec<HmrSocket>,

    // Debugging
    /// Reference count to number of active sockets with the incremental_visualizer enabled.
    pub(crate) emit_incremental_visualizer_events: u32,
    /// Reference count to number of active sockets with the memory_visualizer enabled.
    pub(crate) emit_memory_visualizer_events: u32,
    pub(crate) timers: bun_ptr::AliasableBox<DevServerTimers>,

    pub(crate) assume_perfect_incremental_bundling: bool,

    /// If true, console logs from the browser will be echoed to the server console.
    pub(crate) broadcast_console_log_from_browser_to_server: bool,
}

const INTERNAL_PREFIX: &str = "/_bun";

/// Assets which are routed to the `Assets` storage.
pub(crate) const ASSET_PREFIX: &str = const_format::concatcp!(INTERNAL_PREFIX, "/asset");

/// Client scripts are available at `/_bun/client/{name}-{rbi}{generation}.js`
/// where:
/// - `name` is the display name of the route, such as "index" or
///          "about". It is ignored when routing.
/// - `rbi` is the route bundle index, in padded hex (e.g. `00000001`)
/// - `generation` which is initialized to a random value. This value is
///                re-randomized whenever `client_bundle` is invalidated.
///
/// Example: `/_bun/client/index-00000000f209a20e.js`
pub(crate) const CLIENT_PREFIX: &str = const_format::concatcp!(INTERNAL_PREFIX, "/client");

/// `test/bake/deinitialization.test.ts` checks for this as well as all tests
/// using the dev server test harness.
static DEV_SERVER_DEINIT_COUNT_FOR_TESTING: ::core::sync::atomic::AtomicUsize =
    ::core::sync::atomic::AtomicUsize::new(0);

pub(crate) fn get_deinit_count_for_testing() -> usize {
    DEV_SERVER_DEINIT_COUNT_FOR_TESTING.load(::core::sync::atomic::Ordering::Relaxed)
}

type DebuggerId = jsc::debugger::DebuggerId;

type BunFrontendDevServerAgent<'a> =
    crate::bake::dev_server::inspector_agent::BunFrontendDevServerAgent<'a>;
