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

use ::core::ffi::c_void;
use bun_bundler::mal_prelude::*;
use std::io::Write as _;
use std::time::Instant;

use bun_alloc::{AllocError, Arena};
use bun_ast::Log;
use bun_bundler::options_impl::TargetExt as _;
use bun_collections::{ArrayHashMap, DynamicBitSet, HashMap, HiveArrayFallback, StringHashMap};
use bun_core::{self as str, String as BunString, ZStr, strings};
use bun_core::{Environment, Output};
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
use crate::server::html_bundle::HTMLBundleRoute;
use crate::timer::{EventLoopTimerState, EventLoopTimerTag};
use bun_ast::Loader;
use bun_bundler::{self as bundler, BundleV2, Transpiler};
use bun_http::{Method, MimeType};
use bun_safety::ThreadLock;
use bun_watcher::Watcher;

pub(super) use self::assets::Assets;
pub(super) use self::error_report_request::ErrorReportRequest;

pub(super) use self::incremental_graph::IncrementalGraph;
pub(super) use self::memory_cost::MemoryCost;

bun_output::declare_scope!(DevServer, visible);
bun_output::declare_scope!(SourceMapStore, visible);

bun_output::define_scoped_log!(debug_log, crate::bake::dev_server::DevServer);
bun_output::define_scoped_log!(map_log, crate::bake::dev_server::SourceMapStore);

use core::sync::atomic::Ordering;

use bun_collections::StringArrayHashMap;
use bun_sys::FdExt as _;

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
mod watcher_atomics;

pub(super) use crate::server::SavedRequestUnion;
pub(crate) use bundle::EntryPointList;
use bundle::{RouteIndexAndRecurseFlag, TestingBatch};
use deferred_request::{DeferredRequest, DeferredScriptRequest, Handler, ResponseAndMethod};
pub(crate) use directory_watch_store::DirectoryWatchStore;
use ensure_route::{HTMLRouter, ReqOrSaved, RequestEnsureRouteBundledCtx, ensure_route_is_bundled};
use failures::mark_all_route_children;
pub(crate) use finalize::{CachedFileIndex, HotUpdateContext};
use hmr_socket::hmr_socket_behavior;
pub(crate) use hot_reload_event::HotReloadEvent;
use http::{
    DevHandlerId, dev_route_tramp, extract_pathname_from_url, host_forbidden,
    is_allowed_dev_origin, on_outdated_js_corked, origin_forbidden,
};
pub(crate) use http::{is_allowed_dev_host, is_allowed_host_header};
pub(crate) use lifecycle::init;
pub(crate) use protocol::{ConsoleLogKind, HmrTopic, HmrTopicBits, IncomingMessageId, MessageId};
use router_glue::{OpaqueFileIdOrOptional, from_opaque_file_id, to_opaque_file_id};
pub(crate) use watcher_atomics::{NextEvent, WatcherAtomics};

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
pub(crate) use bun_event_loop::EventLoopTimer::{EventLoopTimer, Tag as TimerTag};

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
        self.server_bits.unmanaged.set_all(false);
        self.client_bits.unmanaged.set_all(false);
        self.failures.clear();
    }

    pub(crate) fn resize(&mut self, side: Side, new_size: usize) -> Result<(), crate::Error> {
        let b = self.bits(side);
        if b.unmanaged.bit_length < new_size {
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
    /// BACKREF: owned by `dev.active_websocket_connections`; destroyed via
    /// `remove` + `heap::take` in `on_close`.
    pub(crate) dev: bun_ptr::BackRef<DevServer, bun_ptr::Mut>,
    pub(crate) underlying: Option<bun_uws::AnyWebSocket>,
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
    /// SAFETY: single JS thread; caller must not hold an aliasing `&mut`.
    #[inline]
    pub(crate) fn vm_mut(&self) -> &mut VirtualMachine {
        debug_assert!(::core::ptr::eq(
            self.vm.as_const_ptr(),
            VirtualMachine::get()
        ));
        VirtualMachine::get_mut()
    }

    // ── transpiler accessors ───────────────────────────────────────────────
    // The three transpilers are `MaybeUninit` until `init()` writes them via
    // `Framework::init_transpiler`. Every access after `init()` returns goes
    // through these helpers; the SAFETY contract is that `init()` is the only
    // constructor and it always populates all three before returning `Ok`.
    #[inline]
    pub(crate) fn server_transpiler(&self) -> &Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.server_transpiler.assume_init_ref() }
    }
    #[inline]
    pub(crate) fn server_transpiler_mut(&mut self) -> &mut Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.server_transpiler.assume_init_mut() }
    }
    #[inline]
    pub(crate) fn client_transpiler(&self) -> &Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.client_transpiler.assume_init_ref() }
    }
    #[inline]
    pub(crate) fn client_transpiler_mut(&mut self) -> &mut Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.client_transpiler.assume_init_mut() }
    }
    #[inline]
    pub(crate) fn ssr_transpiler_mut(&mut self) -> &mut Transpiler<'static> {
        // SAFETY: written in `init()` before any access.
        unsafe { self.ssr_transpiler.assume_init_mut() }
    }
}
pub(super) use crate::bake::dev_server::route_bundle::RouteBundle;
pub(super) use crate::bake::dev_server::source_map_store::SourceMapStore;

pub(crate) struct Options<'a> {
    /// Arena must live until DevServer drops
    pub arena: &'a Arena,
    pub root: &'a ZStr,
    pub vm: &'a VirtualMachine,
    pub framework: bake::Framework,
    pub bundler_options: bake::SplitBundlerOptions,
    pub broadcast_console_log_from_browser_to_server: bool,
}

// The fields `client_graph`, `server_graph`, `directory_watchers`, and `assets`
// all use `@fieldParentPointer` to access DevServer's state. This pattern has
// made it easier to group related fields together, but one must remember those
// structures still depend on the DevServer pointer.

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
    /// pointer is written into `server_transpiler.options.plugin`
    Unknown,
    // These two states mean that `server.getOrLoadPlugins()` was called.
    Pending,
    Loaded,
    /// Currently, this represents a degraded state where no bundle can
    /// be correctly executed because the plugins did not load successfully.
    Err,
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
/// while in-flight. All allocations held by `.bv2.graph.heap`'s arena
pub(crate) struct CurrentBundle {
    /// OWNED (LIFETIMES.tsv): `BundleV2.init()` → `deinitWithoutFreeingArena()`.
    /// Note: `'static` is a stand-in for the DevServer-self lifetime —
    /// `BundleV2<'a>` borrows the three `Transpiler<'_>` fields stored inline
    /// in `DevServer`, so the true bound is the `Box<DevServer>` allocation
    /// (stable address, never moved post-init). Threading a real `'dev` would
    /// make `DevServer` self-referential; raw-ptr aliasing inside `BundleV2`
    /// already encodes that contract.
    pub(crate) _bv2: Box<BundleV2<'static>>,
    /// Owns the arena that `bv2.graph.heap` borrows (`'static` self-ref via the
    /// boxed allocation's stable address; same erasure as `bv2` above).
    pub(crate) _heap: Box<bun_alloc::MimallocArena>,
    /// Backs the small `AstVec`s built during bundle setup
    /// (`start_async_bundle`'s AST scope); dropped with the bundle.
    pub(crate) _ast_alloc_state: Option<Box<bun_alloc::ast_alloc::AstAllocState>>,
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
    /// Owned by `deferred_request_pool` in DevServer.
    pub(crate) requests: deferred_request::List,
    /// Answered by `finalize_bundle_cleanup`.
    pub(crate) script_requests: Vec<bun_ptr::RefPtr<DeferredScriptRequest>>,
    /// Resolution failures are grouped by incremental graph file index.
    /// Unlike parse failures (`handleParseTaskFailure`), the resolution
    /// failures can be created asynchronously, and out of order.
    pub(crate) resolution_failure_entries: ArrayHashMap<serialized_failure::OwnerPacked, Log>,
}

pub(crate) struct NextBundle {
    /// A list of `RouteBundle`s which have active requests to bundle it.
    pub(crate) route_queue: ArrayHashMap<route_bundle::Index, ()>,
    /// If a reload event exists and should be drained. The information
    /// for this watch event is in one of the `watch_events`
    pub(crate) reload_event: Option<*mut HotReloadEvent>, // BORROW_FIELD: ptr into dev.watcher_atomics.events[]
    /// The list of requests that are blocked on this bundle.
    pub(crate) requests: deferred_request::List,
}

// The `Transpiler<'static>` / `BundleV2<'static>` lifetime is the DevServer-self
// lifetime stand-in: those borrows point at fields stored inline in the
// `Box<DevServer>` allocation, which is never moved post-`init()`.
pub(crate) struct DevServer {
    /// To validate the DevServer has not been collected, this can be checked.
    /// When freed, this is set to `undefined`. UAF here also trips ASAN.
    pub(crate) magic: Magic,
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
    /// JSC_BORROW (LIFETIMES.tsv): passed in via `Options.vm`; deinit no-op.
    /// [`BackRef`](bun_ptr::BackRef) (not `&'a`) so `DevServer` is not
    /// lifetime-generic — it is `Box`-owned by `ServerInstance` which outlives
    /// the VM anyway. The back-reference invariant (pointee outlives holder)
    /// is the JSC_BORROW guarantee: vm is valid for DevServer's entire
    /// lifetime.
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>,
    /// How the file-watcher thread submits hot-reload events to the VM.
    pub(crate) vm_handle: bun_jsc::VmHandle,
    /// May be `None` if not attached to an HTTP server yet. When no server is
    /// available, functions taking in requests and responses are unavailable.
    /// However, a lot of testing in this mode is missing, so it may hit assertions.
    pub(crate) server: Option<AnyServer>,
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
    // Note: the watcher thread owns this allocation at shutdown (it frees it
    // in `thread_main` once `running` flips false). Auto-dropping a
    // `Box<Watcher>` here would free the heap block while the watcher thread
    // is still blocked in `GetQueuedCompletionStatus`/`read()` holding a
    // `*mut Watcher` into it (and on Windows the kernel still has a pending
    // `ReadDirectoryChangesW` against the inline `DirWatcher.buf`/`overlapped`).
    // `ManuallyDrop` so `Drop for DevServer` can hand the raw pointer to
    // `Watcher::shutdown` instead.
    pub(crate) bun_watcher: ::core::mem::ManuallyDrop<Box<Watcher>>,
    pub(crate) directory_watchers: DirectoryWatchStore,
    /// Heap-owned via `heap::into_raw` so a still-queued
    /// `HotReloadEvent.concurrent_task` can outlive `DevServer`; see the
    /// `next_event` check in `Drop`.
    pub(crate) watcher_atomics: ::core::ptr::NonNull<WatcherAtomics>,
    pub(crate) testing_batch_events: TestingBatchEvents,

    /// Number of bundles that have been executed. This is currently not read, but
    /// will be used later to determine when to invoke graph garbage collection.
    pub(crate) generation: usize,
    /// Displayed in the HMR success indicator
    pub(crate) bundles_since_last_error: usize,

    pub(crate) framework: bake::Framework,
    pub(crate) bundler_framework_views: Vec<*mut bun_bundler::bake_types::Framework>,
    pub(crate) bundler_options: bake::SplitBundlerOptions,
    // Each logical graph gets its own bundler configuration.
    // Note: `'static` is the DevServer-self lifetime stand-in (see
    // `CurrentBundle.bv2`). `Transpiler<'a>` borrows the global
    // `Fs::FileSystem` singleton + `dot_env::Loader`, both of which outlive
    // the server.
    // `MaybeUninit` until `Framework::init_transpiler` populates them in place
    // (in `init()` below) — `Transpiler` contains a non-nullable `&Arena`, so
    // neither `Default` nor `mem::zeroed()` are sound (PORTING.md §Forbidden).
    pub(crate) server_transpiler: ::core::mem::MaybeUninit<Transpiler<'static>>,
    pub(crate) client_transpiler: ::core::mem::MaybeUninit<Transpiler<'static>>,
    pub(crate) ssr_transpiler: ::core::mem::MaybeUninit<Transpiler<'static>>,
    /// The log used by all `server_transpiler`, `client_transpiler` and `ssr_transpiler`.
    /// Note that it is rarely correct to write messages into it. Instead, associate
    /// messages with the IncrementalGraph file or Route using `SerializedFailure`
    pub(crate) log: Log,
    pub(crate) plugin_state: PluginState,
    /// See `CurrentBundle` doc comment.
    pub(crate) current_bundle: Option<CurrentBundle>,
    /// When `current_bundle` is non-null and new requests to bundle come in,
    /// those are temporaried here. When the current bundle is finished, it
    /// will immediately enqueue this.
    pub(crate) next_bundle: NextBundle,
    pub(crate) deferred_request_pool:
        HiveArrayFallback<deferred_request::Node, { DeferredRequest::MAX_PREALLOCATED }>,
    /// UWS can handle closing the websocket connections themselves
    pub(crate) active_websocket_connections: HashMap<*mut HmrSocket, ()>,

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

type BunFrontendDevServerAgent =
    crate::bake::dev_server::inspector_agent::BunFrontendDevServerAgent;
