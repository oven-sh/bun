//! Instance of the development server. Attaches to an instance of `Bun.serve`,
//! controlling bundler, routing, and hot module reloading.
//!
//! B-2 keystone L: struct + lifecycle un-gated. The 4.8 kL of request
//! handling, hot-update tracing, and `finalize_bundle` remain in the gated
//! Phase-A draft `../DevServer.rs` (preserved on disk via ``).
//! What is real here:
//!   - `DevServer` struct with all LIFETIMES.tsv-classified fields
//!   - leaf enums/newtypes (`FileKind`, `ChunkKind`, `Magic`, `MessageId`, …)
//!   - submodule struct types (`Assets`, `RouteBundle`, `SourceMapStore`, …)
//!   - `bun_bundler::dispatch::DevServerVTable` wiring (`DEV_SERVER_VTABLE`)
//!   - `is_file_cached` (the one vtable slot whose body has no jsc/BundleV2 dep)

#![allow(clippy::module_inception)]
#![allow(unexpected_cfgs)] // `feature = "bake_debugging_features"` mirrors Zig `bun.FeatureFlags.bake_debugging_features`; not yet a declared cargo feature.

use core::sync::atomic::{AtomicI32, Ordering};

use bun_collections::{
    bit_set::DynamicBitSet, ArrayHashMap, HiveArray, StringArrayHashMap, StringHashMap,
};
use bun_logger::Log;
use bun_safety::ThreadLock;

use super::framework_router::{self, FrameworkRouter, OpaqueFileId, RouteIndex};
use super::jsc;
use super::{Framework, Graph, Side, SplitBundlerOptions};
use crate::server::{html_bundle::HTMLBundleRoute, AnyServer, SavedRequest, StaticRoute};

// ─── gated Phase-A submodule drafts (full bodies preserved) ──────────────────
// Each draft is a faithful port of the `.zig` sibling but depends on
// `bun_jsc` method surface and/or `bun_bundler::BundleV2` field access.
 #[path = "../DevServer/Assets.rs"]              mod assets_body;
 #[path = "../DevServer/DirectoryWatchStore.rs"] mod directory_watch_store_body;
 #[path = "../DevServer/ErrorReportRequest.rs"]  mod error_report_request_body;
 #[path = "../DevServer/HmrSocket.rs"]           mod hmr_socket_body;
 #[path = "../DevServer/HotReloadEvent.rs"]      mod hot_reload_event_body;
 #[path = "../DevServer/IncrementalGraph.rs"]    mod incremental_graph_body;
 #[path = "../DevServer/PackedMap.rs"]           mod packed_map_body;
 #[path = "../DevServer/RouteBundle.rs"]         mod route_bundle_body;
 #[path = "../DevServer/SerializedFailure.rs"]   mod serialized_failure_body;
 #[path = "../DevServer/SourceMapStore.rs"]      mod source_map_store_body;
 #[path = "../DevServer/WatcherAtomics.rs"]      mod watcher_atomics_body;
 #[path = "../DevServer/memory_cost.rs"]         mod memory_cost_body;

bun_core::declare_scope!(DevServer, visible);

pub const INTERNAL_PREFIX: &str = "/_bun";
pub const ASSET_PREFIX: &str = "/_bun/asset";
pub const CLIENT_PREFIX: &str = "/_bun/client";

/// `bun.jsc.Debugger.DevServerId`.
pub type DebuggerId = jsc::DebuggerId;

/// In debug builds the discriminant is a 128-bit canary so UAF/poison is
/// loudly detected; in release the field is zero-sized.
#[cfg(debug_assertions)]
#[repr(u128)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Magic { Valid = 0x1ffd363f121f5c12 }
#[cfg(not(debug_assertions))]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Magic { Valid }

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PluginState {
    Unknown,
    Pending,
    Loaded,
    Err,
}

/// `DevServer.FileKind` — must match `bun_bundler::bake_types::CacheKind`
/// discriminants exactly (the vtable boundary transmutes between them).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FileKind {
    Unknown = 0,
    Js = 1,
    Asset = 2,
    Css = 3,
}
impl FileKind {
    #[inline] pub fn has_inline_js_code_chunk(self) -> bool {
        matches!(self, FileKind::Js | FileKind::Asset)
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ChunkKind {
    InitialResponse = 0,
    HmrChunk = 1,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TraceImportGoal {
    FindCss,
    FindClientModules,
    FindErrors,
}

/// `DevServer.ConsoleLog.Kind` — `enum(u8) { log = 'l', err = 'e' }`.
/// Discriminants MUST match Zig: `kind as u8` is sent across FFI to
/// `InspectorBunFrontendDevServerAgent__notifyConsoleLog`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ConsoleLogKind {
    Log = b'l',
    Err = b'e',
}

/// `DevServer.MessageId` — first byte of every server→client HMR frame.
/// Discriminants MUST match `DevServer.zig` exactly (HMR wire protocol).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum MessageId {
    Version = b'V',
    HotUpdate = b'u',
    Errors = b'e',
    BrowserMessage = b'b',
    BrowserMessageClear = b'B',
    RequestHandlerError = b'h',
    Visualizer = b'v',
    MemoryVisualizer = b'M',
    SetUrlResponse = b'n',
    TestingWatchSynchronization = b'r',
}
impl MessageId {
    #[inline] pub fn char(self) -> u8 { self as u8 }
}

/// `DevServer.IncomingMessageId` — first byte of every client→server HMR frame.
/// Discriminants MUST match `DevServer.zig` exactly (HMR wire protocol).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum IncomingMessageId {
    Init = b'i',
    Subscribe = b's',
    SetUrl = b'n',
    TestingBatchEvents = b'H',
    ConsoleLog = b'l',
    UnrefSourceMap = b'u',
}

/// `DevServer.HmrTopic`. Discriminants MUST match `DevServer.zig` exactly.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum HmrTopic {
    HotUpdate = b'h',
    Errors = b'e',
    BrowserError = b'E',
    IncrementalVisualizer = b'v',
    MemoryVisualizer = b'M',
    TestingWatchSynchronization = b'r',
}

/// `RouteIndexAndRecurseFlag` — `packed struct(u32)` (31-bit index + 1 flag).
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct RouteIndexAndRecurseFlag(pub u32);
impl RouteIndexAndRecurseFlag {
    #[inline] pub fn new(idx: RouteIndex, recurse: bool) -> Self {
        Self(idx.get() | ((recurse as u32) << 31))
    }
    #[inline] pub fn route_index(self) -> RouteIndex { RouteIndex::init(self.0 & 0x7FFF_FFFF) }
    #[inline] pub fn should_recurse_when_visiting(self) -> bool { (self.0 >> 31) != 0 }
}

/// `DevServer.CacheEntry` — return of `is_file_cached`. Mirrors
/// `bun_bundler::bake_types::CacheEntry`.
#[derive(Copy, Clone)]
pub struct CacheEntry {
    pub kind: FileKind,
}

/// Incremented in `Drop` so tests can assert deinit ran.
pub static DEV_SERVER_DEINIT_COUNT_FOR_TESTING: AtomicI32 = AtomicI32::new(0);

// ──────────────────────────────────────────────────────────────────────────
// AllocationScope
// ──────────────────────────────────────────────────────────────────────────
/// `bun.allocators.AllocationScopeIn(bun.DefaultAllocator)`.
pub type AllocationScope = bun_alloc::AllocationScope;

// ──────────────────────────────────────────────────────────────────────────
// EventLoopTimer
// ──────────────────────────────────────────────────────────────────────────
pub use bun_event_loop::EventLoopTimer::{EventLoopTimer, Tag as TimerTag};

// ──────────────────────────────────────────────────────────────────────────
// EntryPointList
// ──────────────────────────────────────────────────────────────────────────
pub mod entry_point_list {
    bitflags::bitflags! {
        #[derive(Default, Copy, Clone)]
        #[repr(transparent)]
        pub struct Flags: u8 {
            const CLIENT = 1 << 0;
            const SERVER = 1 << 1;
            const SSR    = 1 << 2;
            /// When this is set, also set CLIENT.
            const CSS    = 1 << 3;
        }
    }
}
#[derive(Default)]
pub struct EntryPointList {
    pub set: StringArrayHashMap<entry_point_list::Flags>,
}
impl EntryPointList {
    /// `EntryPointList.appendCss` — DevServer.zig.
    pub fn append_css(&mut self, abs_path: &[u8]) {
        let gop = bun_core::handle_oom(self.set.get_or_put(abs_path));
        if gop.found_existing {
            *gop.value_ptr |= entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS;
        } else {
            *gop.value_ptr = entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TestingBatch
// ──────────────────────────────────────────────────────────────────────────
pub struct TestingBatch {
    pub entry_points: EntryPointList,
}
impl TestingBatch {
    /// `TestingBatch.append` — DevServer.zig. Full body in gated draft.
    pub fn append(&mut self, _entry_points: &EntryPointList) {
        todo!("blocked_on: dev_server::TestingBatch::append body un-gate")
    }
}
pub enum TestingBatchEvents {
    Disabled,
    EnableAfterBundle,
    Enabled(TestingBatch),
}

// ──────────────────────────────────────────────────────────────────────────
// IncrementalResult / GraphTraceState
// ──────────────────────────────────────────────────────────────────────────
pub struct IncrementalResult {
    pub framework_routes_affected: Vec<RouteIndexAndRecurseFlag>,
    pub html_routes_soft_affected: Vec<route_bundle::Index>,
    pub html_routes_hard_affected: Vec<route_bundle::Index>,
    pub had_adjusted_edges: bool,
    pub client_components_added: Vec<incremental_graph::FileIndex>,
    pub client_components_removed: Vec<incremental_graph::FileIndex>,
    pub failures_removed: Vec<SerializedFailure>,
    pub client_components_affected: Vec<incremental_graph::FileIndex>,
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

    /// DevServer.zig:3528 `IncrementalResult.reset` — `clearRetainingCapacity()`
    /// on each list, asserts `failures_removed` was already drained, and
    /// intentionally leaves `had_adjusted_edges` untouched.
    pub fn reset(&mut self) {
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

pub struct GraphTraceState {
    pub client_bits: DynamicBitSet,
    pub server_bits: DynamicBitSet,
}
impl GraphTraceState {
    #[inline] pub fn bits(&mut self, side: Side) -> &mut DynamicBitSet {
        match side { Side::Client => &mut self.client_bits, Side::Server => &mut self.server_bits }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DeferredRequest / DeferredPromise
// ──────────────────────────────────────────────────────────────────────────
pub mod deferred_request {
    use super::*;
    pub const MAX_PREALLOCATED: usize = 16;

    pub enum Handler {
        ServerHandler(SavedRequest),
        BundledHtmlPage(ResponseAndMethod),
        Aborted,
    }
    pub struct ResponseAndMethod {
        pub resp: bun_uws::AnyResponse,
        pub method: bun_http_types::Method::Method,
    }

    pub struct DeferredRequest {
        pub route_bundle_index: route_bundle::Index,
        pub handler: Handler,
        /// BACKREF: owned by `dev.deferred_request_pool` (LIFETIMES.tsv).
        pub dev: *const DevServer,
        pub referenced_by_devserver: bool,
        pub weakly_referenced_by_requestcontext: bool,
    }

    /// Intrusive singly-linked list node.
    pub struct Node {
        pub data: DeferredRequest,
        pub next: Option<core::ptr::NonNull<Node>>,
    }
    #[derive(Default)]
    pub struct List {
        pub first: Option<core::ptr::NonNull<Node>>,
    }
}
pub use deferred_request::DeferredRequest;

#[derive(Default)]
pub struct DeferredPromise {
    pub strong: jsc::JSPromiseStrong,
    pub route_bundle_indices: ArrayHashMap<route_bundle::Index, ()>,
}

// ──────────────────────────────────────────────────────────────────────────
// CurrentBundle / NextBundle
// ──────────────────────────────────────────────────────────────────────────
/// One bundle executes at a time; this holds its in-flight state.
pub struct CurrentBundle {
    /// OWNED (LIFETIMES.tsv): `BundleV2.init()` → `deinitWithoutFreeingArena()`.
    /// PORT NOTE: `'static` is a stand-in for the DevServer-self lifetime —
    /// `BundleV2<'a>` borrows the three `Transpiler<'_>` fields stored inline
    /// in `DevServer`, so the true bound is the `Box<DevServer>` allocation
    /// (stable address, never moved post-init). Threading a real `'dev` would
    /// make `DevServer` self-referential; raw-ptr aliasing inside `BundleV2`
    /// already encodes that contract.
    pub bv2: Box<bun_bundler::BundleV2<'static>>,
    /// `bundle_v2.DevServerInput` (was `BakeBundleStart` in Zig). Stored erased
    /// because the concrete type lives in the gated `__phase_a_draft` of
    /// `bundle_v2.rs`; `current_bundle_start_data` vtable slot casts back.
    // TODO(b2): `bun_bundler::bundle_v2::DevServerInput` once un-gated.
    pub start_data: *mut (),
    pub timer: std::time::Instant,
    pub had_reload_event: bool,
    pub requests: deferred_request::List,
    pub resolution_failure_entries: ArrayHashMap<serialized_failure::OwnerPacked, Log>,
    pub promise: DeferredPromise,
}

pub struct NextBundle {
    pub route_queue: ArrayHashMap<route_bundle::Index, ()>,
    /// BORROW_FIELD: ptr into `dev.watcher_atomics.events[]` (LIFETIMES.tsv).
    pub reload_event: Option<*mut HotReloadEvent>,
    pub requests: deferred_request::List,
    pub promise: DeferredPromise,
}

// ──────────────────────────────────────────────────────────────────────────
// HTMLRouter
// ──────────────────────────────────────────────────────────────────────────
/// Does not increment refcounts; lifetimes tied to the owning `Bun.serve`
/// instance (LIFETIMES.tsv: BORROW_PARAM `&'a HTMLBundleRoute`).
#[derive(Default)]
pub struct HTMLRouter {
    // SAFETY: lifetime tied to Bun.serve; deinit ignores (DevServer.zig:4393).
    pub map: StringHashMap<*const HTMLBundleRoute>,
    pub fallback: Option<*const HTMLBundleRoute>,
}

// ──────────────────────────────────────────────────────────────────────────
// Submodule types (struct shapes un-gated; method bodies stay in drafts)
// ──────────────────────────────────────────────────────────────────────────
pub mod route_bundle;
pub mod incremental_graph;
pub mod assets;
pub mod source_map_store;
pub mod serialized_failure;
pub mod packed_map;
mod lifecycle;

pub use assets::Assets;
pub use incremental_graph::IncrementalGraph;
pub use packed_map::PackedMap;
pub use route_bundle::RouteBundle;
pub use serialized_failure::SerializedFailure;
pub use source_map_store::SourceMapStore;

/// Local stand-in for the unported `bun_uws::ResponseLike` trait — Zig's
/// `resp: anytype` modeled as a generic bound. Method shapes mirror
/// `bun_uws_sys::Response<SSL>` so the `R`-generic bodies type-check.
// TODO(port): replace with `bun_uws::ResponseLike` once it lands upstream.
pub trait ResponseLike {
    fn write_status(&mut self, status: &[u8]);
    fn end(&mut self, data: &[u8], close_connection: bool);
    fn as_any_response(&mut self) -> bun_uws::AnyResponse;
    fn get_remote_socket_info(&mut self) -> Option<bun_uws::SocketAddress>;
    fn upgrade<D>(
        &mut self,
        data: D,
        sec_web_socket_key: &[u8],
        sec_web_socket_protocol: &[u8],
        sec_web_socket_extensions: &[u8],
        ctx: &mut bun_uws::WebSocketUpgradeContext,
    );
}

/// `DevServer.HmrSocket` — per-WebSocket state. Full body (open/close/message
/// handlers) gated in `HmrSocket.rs` (heavy `bun_uws` + jsc dep).
pub struct HmrSocket {
    /// BACKREF: owned by `dev.active_websocket_connections`.
    pub dev: *const DevServer,
    pub underlying: Option<bun_uws::AnyWebSocket>,
    pub current_route: route_bundle::IndexOptional,
    pub subscriptions: u8, // packed bitset of HmrTopic
}

/// `DevServer.HotReloadEvent` — produced by the watcher thread.
pub struct HotReloadEvent {
    /// BACKREF (LIFETIMES.tsv): inline element of `WatcherAtomics.events: [3]`.
    pub owner: *const DevServer,
    pub concurrent_task: bun_event_loop::ConcurrentTask::ConcurrentTask,
    pub files: StringArrayHashMap<()>,
    pub dirs: StringArrayHashMap<()>,
    /// NUL-joined absolute paths (`ArrayListUnmanaged(u8)` in Zig).
    pub extra_files: Vec<u8>,
    pub timer: std::time::Instant,
    /// 1 if referenced, 0 if unreferenced; see `WatcherAtomics`.
    pub contention_indicator: core::sync::atomic::AtomicU32,
    #[cfg(debug_assertions)]
    pub debug_mutex: bun_threading::Mutex,
}

impl bun_event_loop::Taskable for HotReloadEvent {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::BakeHotReloadEvent;
}

impl HotReloadEvent {
    pub fn init_empty(owner: *const DevServer) -> HotReloadEvent {
        HotReloadEvent {
            owner,
            concurrent_task: Default::default(),
            files: Default::default(),
            dirs: Default::default(),
            extra_files: Vec::new(),
            timer: std::time::Instant::now(),
            contention_indicator: core::sync::atomic::AtomicU32::new(0),
            #[cfg(debug_assertions)]
            debug_mutex: bun_threading::Mutex::default(),
        }
    }

    pub fn is_empty(&self) -> bool {
        (self.files.count() + self.dirs.count()) == 0
    }

    pub fn reset(&mut self) {
        #[cfg(debug_assertions)]
        self.debug_mutex.unlock();
        self.files.clear_retaining_capacity();
        self.dirs.clear_retaining_capacity();
        self.extra_files.clear();
    }
}

/// `DevServer.WatcherAtomics` — three pre-allocated `HotReloadEvent`s
/// rotated between the watcher thread and the main thread.
pub struct WatcherAtomics {
    pub events: [HotReloadEvent; 3],
    /// `next_event: std.atomic.Value(NextEvent)` — encodes the `NextEvent`
    /// `enum(u8) { 0..3 = event index, .waiting, .done }`.
    pub next_event: core::sync::atomic::AtomicU8,
    /// Main-thread-only; index into `events` currently being processed.
    pub current_event: Option<u8>,
    /// Main-thread-only; index into `events` queued behind `current_event`.
    pub pending_event: Option<u8>,
}

impl WatcherAtomics {
    /// Full body in gated `../DevServer/WatcherAtomics.rs` draft.
    pub fn recycle_event_from_dev_server(
        &mut self,
        _old_event: *mut HotReloadEvent,
    ) -> Option<*mut HotReloadEvent> {
        todo!("blocked_on: dev_server::WatcherAtomics body un-gate")
    }
}

/// `DevServer.DirectoryWatchStore` — sparse map of directories under watch
/// for resolution-failure recovery. Full body gated in `DirectoryWatchStore.rs`.
#[derive(Default)]
pub struct DirectoryWatchStore {
    pub watches: StringArrayHashMap<directory_watch_store::Entry>,
    pub dependencies: Vec<directory_watch_store::Dep>,
    /// Dependencies cannot be re-ordered. This list tracks what indexes are free.
    pub dependencies_free_list: Vec<u32>,
}
impl DirectoryWatchStore {
    /// Full body in gated `../DevServer/DirectoryWatchStore.rs` draft.
    pub fn free_dependency_index(&mut self, index: u32) {
        // PORT NOTE: minimal port of DirectoryWatchStore.zig:freeDependencyIndex —
        // skips the `dep = .{}` reset (Dep has no Default yet); free-list bookkeeping only.
        if index as usize == self.dependencies.len() - 1 {
            self.dependencies.truncate(self.dependencies.len() - 1);
        } else {
            self.dependencies_free_list.push(index);
        }
    }
    /// Full body in gated `../DevServer/DirectoryWatchStore.rs` draft.
    pub fn free_entry(&mut self, _entry_index: usize) {
        todo!("blocked_on: dev_server::DirectoryWatchStore::free_entry body un-gate")
    }
}
pub mod directory_watch_store {
    /// `DirectoryWatchStore.Entry` — per-watched-directory state.
    pub struct Entry {
        /// `Dep.Index` — head of the singly-linked dep chain for this dir.
        pub first_dep: u32,
        // TODO(b2-blocked): `dir: Watcher.Index` / `dir_fd_on_mac` field — gated
        // on `bun_watcher::Index` un-gate.
    }
    /// `DirectoryWatchStore.Dep` — one resolution-failure to retry on dir change.
    pub struct Dep {
        pub specifier: Box<[u8]>,
        pub source_file_path: super::incremental_graph::FileIndex,
        pub next: Option<u32>,
    }
}

// ══════════════════════════════════════════════════════════════════════════
// DevServer
// ══════════════════════════════════════════════════════════════════════════

/// Incremental bundler dev server. See `DevServer.zig` for full prose.
///
/// All `*const`/`*mut` fields are classified in `docs/LIFETIMES.tsv`; each
/// has a `// SAFETY:` or `// BACKREF:` note here mirroring that table.
///
/// `client_graph`, `server_graph`, `directory_watchers`, and `assets` all
/// use `offset_of!` to recover `&DevServer` (Zig's `@fieldParentPtr`). This
/// means `DevServer` must always be heap-allocated and never moved after
/// `init()` returns; it is held as `Box<DevServer>` by `ServerInstance`.
pub struct DevServer {
    pub magic: Magic,
    pub allocation_scope: AllocationScope,
    pub root: Box<[u8]>,
    pub inspector_server_id: DebuggerId,
    pub configuration_hash_key: [u8; 16],
    /// JSC_BORROW (LIFETIMES.tsv): passed in via `Options.vm`; deinit no-op.
    /// Stored as raw ptr (not `&'a`) so `DevServer` is not lifetime-generic
    /// — it is `Box`-owned by `ServerInstance` which outlives the VM anyway.
    // SAFETY: vm is valid for DevServer's entire lifetime (DevServer.zig:315).
    pub vm: *const jsc::VirtualMachine,
    pub server: Option<AnyServer>,
    pub router: FrameworkRouter,
    pub route_bundles: Vec<RouteBundle>,
    pub graph_safety_lock: ThreadLock,
    pub client_graph: IncrementalGraph,
    pub server_graph: IncrementalGraph,
    pub barrel_files_with_deferrals: StringArrayHashMap<()>,
    pub barrel_needed_exports: StringArrayHashMap<StringHashMap<()>>,
    pub incremental_result: IncrementalResult,
    pub route_lookup: ArrayHashMap<incremental_graph::FileIndex, RouteIndexAndRecurseFlag>,
    pub html_router: HTMLRouter,
    pub assets: Assets,
    pub source_maps: SourceMapStore,
    /// Zig: `AutoArrayHashMapUnmanaged(SerializedFailure, void,
    /// SerializedFailure.ArrayHashContextViaOwner, false)` — keyed by
    /// `failure.owner`. Port stores `OwnerPacked → SerializedFailure` so the
    /// custom context is unnecessary.
    pub bundling_failures: ArrayHashMap<serialized_failure::OwnerPacked, SerializedFailure>,
    pub frontend_only: bool,
    pub has_tailwind_plugin_hack: Option<ArrayHashMap<Box<[u8]>, ()>>,

    pub server_fetch_function_callback: jsc::StrongOptional,
    pub server_register_update_callback: jsc::StrongOptional,

    /// OWNED (LIFETIMES.tsv): `Watcher.init()` → `deinit(true)`.
    pub bun_watcher: Box<bun_watcher::Watcher>,
    pub directory_watchers: DirectoryWatchStore,
    pub watcher_atomics: WatcherAtomics,
    pub testing_batch_events: TestingBatchEvents,

    pub generation: usize,
    pub bundles_since_last_error: usize,

    pub framework: Framework,
    pub bundler_options: SplitBundlerOptions,
    /// PORT NOTE: `'static` is the DevServer-self lifetime stand-in (see
    /// `CurrentBundle.bv2`). `Transpiler<'a>` borrows the global
    /// `Fs::FileSystem` singleton + `dot_env::Loader`, both of which outlive
    /// the server.
    ///
    /// `MaybeUninit` until `Framework::init_transpiler` (gated in
    /// `bake_body.rs`) populates them in place — `Transpiler` contains a
    /// non-nullable `&Arena`, so neither `Default` nor `mem::zeroed()` are
    /// sound (PORTING.md §Forbidden).
    pub server_transpiler: core::mem::MaybeUninit<bun_bundler::Transpiler<'static>>,
    pub client_transpiler: core::mem::MaybeUninit<bun_bundler::Transpiler<'static>>,
    pub ssr_transpiler: core::mem::MaybeUninit<bun_bundler::Transpiler<'static>>,
    pub log: Log,
    pub plugin_state: PluginState,
    pub current_bundle: Option<CurrentBundle>,
    pub next_bundle: NextBundle,
    pub deferred_request_pool: HiveArray<deferred_request::Node, { deferred_request::MAX_PREALLOCATED }>,
    pub active_websocket_connections: bun_collections::HashMap<*mut HmrSocket, ()>,

    #[cfg(feature = "bake_debugging_features")]
    pub dump_dir: Option<bun_sys::Fd>,
    pub emit_incremental_visualizer_events: u32,
    pub emit_memory_visualizer_events: u32,
    pub memory_visualizer_timer: EventLoopTimer,

    pub has_pre_crash_handler: bool,
    pub assume_perfect_incremental_bundling: bool,
    pub broadcast_console_log_from_browser_to_server: bool,
}

impl DevServer {
    /// `DevServer.publish` — DevServer.zig:4163. Full body in gated `../DevServer.rs`
    /// draft (depends on `AnyServer::publish`).
    pub fn publish(&self, _topic: HmrTopic, _message: &[u8], _opcode: bun_uws::Opcode) {
        todo!("blocked_on: dev_server::DevServer::publish (AnyServer::publish un-gate)")
    }

    /// `DevServer.startAsyncBundle`. Full body in gated `../DevServer.rs` draft.
    pub fn start_async_bundle(
        &mut self,
        _entry_points: EntryPointList,
        _is_hot_reload: bool,
        _timer: std::time::Instant,
    ) -> Result<(), bun_core::Error> {
        todo!("blocked_on: dev_server::DevServer::start_async_bundle body un-gate")
    }

    /// `DevServer.memoryCost`. Full body gated in `../DevServer/memory_cost.rs`
    /// (depends on `IncrementalGraph::memory_cost_detailed` + `Assets::memory_cost`
    /// which are still draft-only). Stub returns the struct size so
    /// `NewServer::memory_cost` reports a non-zero contribution.
    // TODO(b2-blocked): un-gate `memory_cost_body::memory_cost`.
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    #[inline]
    pub fn route_bundle_ptr(&mut self, idx: route_bundle::Index) -> &mut RouteBundle {
        &mut self.route_bundles[idx.get() as usize]
    }

    /// `dev.isFileCached(abs_path, side)` — DevServer.zig:2128. Exposed via
    /// `DEV_SERVER_VTABLE.is_file_cached` for the bundler.
    pub fn is_file_cached(&mut self, path: &[u8], side: Graph) -> Option<CacheEntry> {
        if self.barrel_files_with_deferrals.contains_key(path) {
            return None;
        }
        // PORT NOTE: `ThreadLock` is a debug-only assertion (not a real lock);
        // Zig's `defer unlock()` becomes a manual pair here because a
        // `scopeguard` closure capturing `&mut self.graph_safety_lock` would
        // alias the `&self.*_graph` borrows below.
        self.graph_safety_lock.lock();
        let g = match side {
            Graph::Client => &self.client_graph,
            Graph::Server | Graph::Ssr => &self.server_graph,
        };
        let r = g.bundled_files.get_index(path).and_then(|index| {
            (!g.stale_files.is_set(index)).then(|| CacheEntry { kind: g.file_kind_at(index) })
        });
        self.graph_safety_lock.unlock();
        r
    }
}

impl Drop for DevServer {
    fn drop(&mut self) {
        DEV_SERVER_DEINIT_COUNT_FOR_TESTING.fetch_add(1, Ordering::Relaxed);
        debug_assert!(self.magic == Magic::Valid);
        // Field Drop handles: route_bundles, *_graph, assets, source_maps,
        // bundling_failures, bun_watcher, *_transpiler, log, allocation_scope.
        //
        // Side-effecty cleanup (websocket close, timer removal, crash-handler
        // unhook, intrusive request-list walk) lives in the gated `DevServer.rs`
        // draft and is blocked on `bun_jsc` + `bun_uws` method surface.
        // TODO(b2-blocked): port full `deinit` body once jsc/uws are real.
        if self.current_bundle.is_some() {
            // DevServer.zig:618 — impossible to deinit this state correctly.
            debug_assert!(false);
        }
        if self.has_pre_crash_handler {
            bun_crash_handler::remove_pre_crash_handler(self as *mut _ as *mut core::ffi::c_void);
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK §Dispatch — DevServerVTable impl (high tier provides static)
// ══════════════════════════════════════════════════════════════════════════

/// The bundler (`bun_bundler`, lower tier) names `DevServerHandle` as an
/// erased `(*mut (), &'static DevServerVTable)` so it can call back into
/// `crate::bake` without a crate cycle. This is the static instance.
/// PERF(port): was inline switch — see PORTING.md §Dispatch (cold path).
pub static DEV_SERVER_VTABLE: bun_bundler::dispatch::DevServerVTable =
    bun_bundler::dispatch::DevServerVTable {
        is_file_cached: |p, abs_path, side| {
            // SAFETY: p is a live *mut DevServer per DevServerHandle invariant.
            let dev = unsafe { &mut *p.cast::<DevServer>() };
            // `bake_types::Side` → `bake_types::Graph` widening matches Zig
            // (DevServer.zig:2128 takes `bake.Graph`).
            dev.is_file_cached(abs_path, side.graph()).map(|e| {
                bun_bundler::bake_types::CacheEntry {
                    // SAFETY: FileKind/CacheKind have identical #[repr(u8)] discriminants.
                    kind: unsafe { core::mem::transmute::<FileKind, _>(e.kind) },
                }
            })
        },
        dupe: |p, bytes| {
            // `dev.allocator().dupe(u8, ..)` — under global mimalloc this is a
            // plain `Box<[u8]>::from(bytes)`. The DevServer-owned arena
            // (`allocation_scope`) is debug-only; see PORTING.md §Allocators.
            // PERF(port): was AllocationScope-tracked dupe.
            let _ = p;
            Box::<[u8]>::from(bytes)
        },
        register_barrel_export: |p, barrel_path, alias| {
            // SAFETY: p is a live *mut DevServer per DevServerHandle invariant.
            let dev = unsafe { &mut *p.cast::<DevServer>() };
            // StringArrayHashMap::get_or_put boxes the key on miss; alloc fail
            // panics (matches Zig `bun.handleOom`).
            let gop = dev
                .barrel_needed_exports
                .get_or_put(barrel_path)
                .unwrap_or_else(|_| bun_alloc::out_of_memory());
            let _ = gop.value_ptr.get_or_put(alias);
        },
    };

impl DevServer {
    /// Construct the erased handle the bundler stores in
    /// `Transpiler.options.dev_server` / `LinkerContext.dev_server`.
    #[inline]
    pub fn bundler_handle(&mut self) -> bun_bundler::dispatch::DevServerHandle {
        bun_bundler::dispatch::DevServerHandle {
            owner: self as *mut Self as *mut (),
            vtable: &DEV_SERVER_VTABLE,
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// init() — DevServer lifecycle
// ══════════════════════════════════════════════════════════════════════════

pub struct Options<'a> {
    pub arena: &'a bun_alloc::Arena,
    pub root: &'a [u8],
    /// JSC_BORROW (LIFETIMES.tsv).
    pub vm: &'a jsc::VirtualMachine,
    pub framework: Framework,
    pub bundler_options: SplitBundlerOptions,
    pub broadcast_console_log_from_browser_to_server: bool,
    pub dump_sources: Option<&'a [u8]>,
    pub dump_state_on_crash: Option<bool>,
}

impl DevServer {
    /// DevServer.zig:300 `init`. The Zig original used `bun.new(DevServer, .{
    /// many = undefined })` then assigned fields in place (transpilers,
    /// watcher, router, watcher_atomics, configuration_hash_key). That
    /// reshaping is preserved in the gated `../DevServer.rs` draft and is
    /// blocked on:
    ///   - `bun_bundler::Transpiler` field access (`options.dev_server = …`)
    ///   - `Framework::init_transpiler` (jsc-dependent)
    ///   - `bun_watcher::Watcher::init::<DevServer>` (needs `WatcherContext`
    ///     impl for DevServer — gated in `HotReloadEvent.rs`)
    ///   - `FrameworkRouter::init_empty` (needs `bun_resolver::DirInfo`)
    ///
    /// Body un-gated in `lifecycle.rs`.
    #[inline]
    pub fn init(options: Options<'_>) -> jsc::JsResult<Box<DevServer>> {
        lifecycle::init_impl(options)
    }
}
