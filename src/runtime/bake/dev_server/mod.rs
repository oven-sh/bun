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
 #[path = "../DevServer/Assets.rs"]              pub(crate) mod assets_body;
 #[path = "../DevServer/DirectoryWatchStore.rs"] pub(crate) mod directory_watch_store_body;
 #[path = "../DevServer/ErrorReportRequest.rs"]  pub(crate) mod error_report_request_body;
 #[path = "../DevServer/HmrSocket.rs"]           pub(crate) mod hmr_socket_body;
 #[path = "../DevServer/HotReloadEvent.rs"]      pub(crate) mod hot_reload_event_body;
 #[path = "../DevServer/IncrementalGraph.rs"]    pub(crate) mod incremental_graph_body;
 #[path = "../DevServer/PackedMap.rs"]           pub(crate) mod packed_map_body;
 #[path = "../DevServer/RouteBundle.rs"]         pub(crate) mod route_bundle_body;
 // SerializedFailure body draft dissolved into `serialized_failure.rs`.
 #[path = "../DevServer/SourceMapStore.rs"]      pub(crate) mod source_map_store_body;
 #[path = "../DevServer/WatcherAtomics.rs"]      pub(crate) mod watcher_atomics_body;
 #[path = "../DevServer/memory_cost.rs"]         pub(crate) mod memory_cost_body;

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

impl HmrTopic {
    /// `HmrTopic.max_count` — `@typeInfo(HmrTopic).@"enum".fields.len`.
    pub const MAX_COUNT: usize = 6;

    /// All variants in declaration order — Zig: `std.enums.values(HmrTopic)`.
    pub const ALL: &[HmrTopic] = &[
        HmrTopic::HotUpdate,
        HmrTopic::Errors,
        HmrTopic::BrowserError,
        HmrTopic::IncrementalVisualizer,
        HmrTopic::MemoryVisualizer,
        HmrTopic::TestingWatchSynchronization,
    ];

    /// Maps the wire-byte discriminant back to the variant (`@enumFromInt`
    /// with range-check). `None` for unknown bytes.
    #[inline]
    pub fn from_u8(ch: u8) -> Option<HmrTopic> {
        match ch {
            b'h' => Some(HmrTopic::HotUpdate),
            b'e' => Some(HmrTopic::Errors),
            b'E' => Some(HmrTopic::BrowserError),
            b'v' => Some(HmrTopic::IncrementalVisualizer),
            b'M' => Some(HmrTopic::MemoryVisualizer),
            b'r' => Some(HmrTopic::TestingWatchSynchronization),
            _ => None,
        }
    }

    /// Maps a topic to its packed `HmrTopicBits` flag.
    #[inline]
    pub fn as_bit(self) -> crate::bake::dev_server_body::HmrTopicBits {
        use crate::bake::dev_server_body::HmrTopicBits;
        match self {
            HmrTopic::HotUpdate => HmrTopicBits::HOT_UPDATE,
            HmrTopic::Errors => HmrTopicBits::ERRORS,
            HmrTopic::BrowserError => HmrTopicBits::BROWSER_ERROR,
            HmrTopic::IncrementalVisualizer => HmrTopicBits::INCREMENTAL_VISUALIZER,
            HmrTopic::MemoryVisualizer => HmrTopicBits::MEMORY_VISUALIZER,
            HmrTopic::TestingWatchSynchronization => HmrTopicBits::TESTING_WATCH_SYNCHRONIZATION,
        }
    }
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
    /// `EntryPointList.append` — DevServer.zig:4351. Deduplicates requests to
    /// bundle the same file twice by OR-ing flags.
    pub fn append(
        &mut self,
        abs_path: &[u8],
        flags: entry_point_list::Flags,
    ) -> Result<(), bun_core::Error> {
        let gop = bun_core::handle_oom(self.set.get_or_put(abs_path));
        if gop.found_existing {
            *gop.value_ptr |= flags;
        } else {
            *gop.value_ptr = flags;
        }
        Ok(())
    }

    /// `EntryPointList.appendCss` — DevServer.zig.
    pub fn append_css(&mut self, abs_path: &[u8]) -> Result<(), bun_core::Error> {
        self.append(abs_path, entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TestingBatch
// ──────────────────────────────────────────────────────────────────────────
#[derive(Default)]
pub struct TestingBatch {
    pub entry_points: EntryPointList,
}
impl TestingBatch {
    /// `TestingBatch.append` — DevServer.zig:4485.
    pub fn append(&mut self, entry_points: &EntryPointList) -> Result<(), bun_core::Error> {
        debug_assert!(entry_points.set.count() > 0);
        for (k, v) in entry_points.set.keys().iter().zip(entry_points.set.values()) {
            self.entry_points.append(k, *v)?;
        }
        Ok(())
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

    pub fn clear(&mut self) {
        self.server_bits.unmanaged.set_all(false);
        self.client_bits.unmanaged.set_all(false);
    }

    pub fn resize(&mut self, side: Side, new_size: usize) -> Result<(), bun_core::Error> {
        let b = match side {
            Side::Client => &mut self.client_bits,
            Side::Server => &mut self.server_bits,
        };
        if b.unmanaged.bit_length < new_size {
            b.resize(new_size, false)?;
        }
        Ok(())
    }

    pub fn clear_and_free(&mut self) {
        self.client_bits.resize(0, false).expect("freeing memory can not fail");
        self.server_bits.resize(0, false).expect("freeing memory can not fail");
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

// PORT NOTE: `init` lives in the Phase-A body draft (`../DevServer.rs` →
// `super::dev_server_body`). Re-export so callers that name
// `crate::bake::dev_server::init` (the canonical path) resolve until the two
// `DevServer` shapes are unified.
pub use super::dev_server_body::init;

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
    fn get_remote_socket_info(&mut self) -> Option<bun_uws::SocketAddress> {
        // `bun_uws_sys::SocketAddress<'static>` borrows the socket's IP buffer;
        // re-box into the owned `bun_uws::SocketAddress` shape this trait uses.
        (*self).get_remote_socket_info().map(|a| bun_uws::SocketAddress {
            ip: a.ip.to_vec().into_boxed_slice(),
            port: a.port,
            is_ipv6: a.is_ipv6,
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
        let boxed = Box::into_raw(Box::new(data));
        // `bun_uws::WebSocketUpgradeContext` and `bun_uws_sys::WebSocketUpgradeContext`
        // are both opaque `#[repr(C)]` ZST handles that only round-trip to
        // `uws_res_upgrade`; cast through the raw pointer.
        // SAFETY: same-layout opaque handle, never dereferenced in Rust.
        let ctx = unsafe {
            &mut *(ctx as *mut bun_uws::WebSocketUpgradeContext
                as *mut bun_uws_sys::WebSocketUpgradeContext)
        };
        let _ = (*self).upgrade(
            boxed,
            sec_web_socket_key,
            sec_web_socket_protocol,
            sec_web_socket_extensions,
            Some(ctx),
        );
    }
}

/// `DevServer.HmrSocket` — per-WebSocket state. Full body (open/close/message
/// handlers) gated in `HmrSocket.rs` (heavy `bun_uws` + jsc dep).
pub struct HmrSocket {
    /// BACKREF: owned by `dev.active_websocket_connections`.
    pub dev: *const DevServer,
    pub underlying: Option<bun_uws::AnyWebSocket>,
    pub current_route: route_bundle::IndexOptional,
    pub subscriptions: u8, // packed bitset of HmrTopic
    /// Source-map keys this socket has been sent; used to ref-count entries
    /// in `SourceMapStore` so they survive until the socket disconnects.
    pub referenced_source_maps: ArrayHashMap<source_map_store::Key, ()>,
}

impl HmrSocket {
    /// `subscriptions` is a packed `HmrTopicBits` value; test the bit for a
    /// given topic.
    #[inline]
    pub fn is_subscribed(&self, topic: HmrTopic) -> bool {
        (self.subscriptions & topic.as_bit().bits()) != 0
    }
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

    /// `HotReloadEvent.processFileList` — HotReloadEvent.zig:78.
    /// Invalidates items in IncrementalGraph, appending all new items to `entry_points`.
    pub fn process_file_list(
        &mut self,
        dev: &mut DevServer,
        entry_points: &mut EntryPointList,
    ) {
        dev.graph_safety_lock.lock();
        // PORT NOTE: erase to raw ptr so the guard closure doesn't hold a unique
        // borrow of `dev` for the rest of the scope (Zig `defer` had no aliasing).
        let lock_ptr: *mut ThreadLock = &mut dev.graph_safety_lock;
        // SAFETY: `lock_ptr` points into `*dev`, which outlives `_g`.
        let _g = scopeguard::guard((), move |_| unsafe { (*lock_ptr).unlock() });

        // First handle directories, because this may mutate `event.files`
        if dev.directory_watchers.watches.count() > 0 {
            for changed_dir_with_slash in self.dirs.keys() {
                let changed_dir =
                    bun_str::strings::paths::without_trailing_slash_windows_path(changed_dir_with_slash);

                // Bust resolution cache, but since Bun does not watch all
                // directories in a codebase, this only targets the following resolutions
                // SAFETY: server_transpiler is initialized in DevServer::init before any
                // HotReloadEvent can fire.
                let _ = unsafe { dev.server_transpiler.assume_init_mut() }
                    .resolver
                    .bust_dir_cache(changed_dir);

                // if a directory watch exists for resolution failures, check those now.
                if let Some(watcher_index) =
                    dev.directory_watchers.watches.get_index(changed_dir)
                {
                    // PORT NOTE: reshaped for borrowck — Zig held `entry` ref while mutating
                    // `dev.directory_watchers.dependencies` and `self.files` in the loop body.
                    let mut new_chain: Option<u32> = None;
                    let mut it: Option<u32> =
                        Some(dev.directory_watchers.watches.values()[watcher_index].first_dep);

                    while let Some(index) = it {
                        // PORT NOTE: reshaped for borrowck — re-index per iteration instead of
                        // holding `dep` ref across resolver call + appendFile + freeDependencyIndex.
                        let (source_file_path, specifier, next) = {
                            let dep = &dev.directory_watchers.dependencies[index as usize];
                            (dep.source_file_path, &*dep.specifier as *const [u8], dep.next)
                        };
                        it = next;

                        // SAFETY: `source_file_path` is a live IncrementalGraph key slice
                        // (BORROWED per `Dep` doc); `specifier` points into the dep's owned
                        // `Box<[u8]>`, neither of which is mutated until after `resolve` returns.
                        let resolved = unsafe { dev.server_transpiler.assume_init_mut() }
                            .resolver
                            .resolve(
                                bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                    unsafe { &*source_file_path },
                                ),
                                unsafe { &*specifier },
                                bun_options_types::ImportKind::Stmt,
                            )
                            .is_ok();

                        if resolved {
                            // this resolution result is not preserved as passing it
                            // into BundleV2 is too complicated. the resolution is
                            // cached, anyways.
                            // PORT NOTE: inlined `append_file` body for disjoint borrow
                            // (`self.dirs.keys()` is held immutably across this loop).
                            // SAFETY: server_graph keys not mutated between lookup and here.
                            let _ = self.files.get_or_put(unsafe { &*source_file_path });
                            dev.directory_watchers.free_dependency_index(index);
                        } else {
                            // rebuild a new linked list for unaffected files
                            dev.directory_watchers.dependencies[index as usize].next = new_chain;
                            new_chain = Some(index);
                        }
                    }

                    if let Some(new_first_dep) = new_chain {
                        dev.directory_watchers.watches.values_mut()[watcher_index].first_dep =
                            new_first_dep;
                    } else {
                        // without any files to depend on this watcher is freed
                        dev.directory_watchers.free_entry(watcher_index);
                    }
                }
            }
        }

        let mut rest_extra: &[u8] = &self.extra_files;
        while let Some(str_idx) = bun_str::strings::index_of_char(rest_extra, 0) {
            bun_core::handle_oom(self.files.put(&rest_extra[0..str_idx as usize], ()));
            rest_extra = &rest_extra[str_idx as usize + 1..];
        }
        if !rest_extra.is_empty() {
            bun_core::handle_oom(self.files.put(rest_extra, ()));
        }

        let changed_file_paths = self.files.keys();
        // PORT NOTE: Zig used `inline for` over a 2-tuple; written out as two calls.
        bun_core::handle_oom(dev.server_graph.invalidate(changed_file_paths, entry_points));
        bun_core::handle_oom(dev.client_graph.invalidate(changed_file_paths, entry_points));

        if entry_points.set.count() == 0 {
            bun_core::Output::debug_warn(format_args!("nothing to bundle"));
            if !changed_file_paths.is_empty() {
                bun_core::Output::debug_warn(format_args!(
                    "modified files: {}",
                    bun_core::fmt::fmt_slice(changed_file_paths, ", ")
                ));
            }
            if self.dirs.count() > 0 {
                bun_core::Output::debug_warn(format_args!(
                    "modified dirs: {}",
                    bun_core::fmt::fmt_slice(self.dirs.keys(), ", ")
                ));
            }

            dev.publish(
                HmrTopic::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 1],
                bun_uws::Opcode::BINARY,
            );
            return;
        }

        if let Some(map) = &dev.has_tailwind_plugin_hack {
            for abs_path in map.keys() {
                let Some(file) = dev.client_graph.bundled_files.get(abs_path) else {
                    continue;
                };
                if file.file_kind() == FileKind::Css {
                    bun_core::handle_oom(entry_points.append_css(abs_path));
                }
            }
        }
    }

    pub fn reset(&mut self) {
        #[cfg(debug_assertions)]
        self.debug_mutex.unlock();
        self.files.clear_retaining_capacity();
        self.dirs.clear_retaining_capacity();
        self.extra_files.clear();
    }

    /// `HotReloadEvent.appendFile` — full body in gated draft.
    pub fn append_file(&mut self, file_path: &[u8]) {
        let _ = self.files.get_or_put(file_path);
    }

    /// `HotReloadEvent.appendDir` — HotReloadEvent.zig:58.
    pub fn append_dir(&mut self, dir_path: &[u8], maybe_sub_path: Option<&[u8]>) {
        if dir_path.is_empty() {
            return;
        }
        let _ = self.dirs.get_or_put(dir_path);

        let Some(sub_path) = maybe_sub_path else { return };
        if sub_path.is_empty() {
            return;
        }

        let ends_with_sep = bun_paths::is_sep_any(dir_path[dir_path.len() - 1]);
        // PERF(port): was ensureUnusedCapacity + appendSliceAssumeCapacity — profile in Phase B
        self.extra_files.extend_from_slice(if ends_with_sep {
            &dir_path[0..dir_path.len() - 1]
        } else {
            dir_path
        });
        self.extra_files.push(bun_paths::SEP);
        self.extra_files.extend_from_slice(sub_path);
        self.extra_files.push(0);
    }

    /// `HotReloadEvent.run` — HotReloadEvent.zig:173. Main-thread side of the
    /// watcher → DevServer hand-off.
    pub fn run(first: &mut HotReloadEvent) {
        // SAFETY: `owner` is a BACKREF to the DevServer that owns the WatcherAtomics array
        // containing this event; DevServer outlives all HotReloadEvents it holds.
        let dev: *mut DevServer = first.owner as *mut DevServer;
        // SAFETY: see above; `magic` read is non-aliasing.
        debug_assert!(unsafe { (*dev).magic } == Magic::Valid);
        bun_core::scoped_log!(DevServer, "HMR Task start");
        let _end_log = scopeguard::guard((), |_| {
            bun_core::scoped_log!(DevServer, "HMR Task end");
        });

        #[cfg(debug_assertions)]
        {
            debug_assert!(first.debug_mutex.try_lock());
            debug_assert!(first.contention_indicator.load(Ordering::SeqCst) == 0);
        }

        // SAFETY: `dev` is the unique BACKREF; this fn runs on the DevServer thread.
        let dev_ref = unsafe { &mut *dev };

        if dev_ref.current_bundle.is_some() {
            dev_ref.next_bundle.reload_event = Some(first as *mut HotReloadEvent);
            return;
        }

        // PERF(port): was stack-fallback allocator (4096 bytes) — profile in Phase B
        let mut entry_points = EntryPointList::default();

        first.process_file_list(dev_ref, &mut entry_points);

        let timer = first.timer;

        // PORT NOTE: raw-ptr loop because `recycle_event_from_dev_server` returns
        // a pointer into `dev.watcher_atomics.events` while `dev_ref` is live;
        // re-borrow each iteration to avoid aliasing UB.
        let mut current: *mut HotReloadEvent = first as *mut HotReloadEvent;
        loop {
            // SAFETY: `current` always points at a live event owned by `dev.watcher_atomics`.
            unsafe { (*current).process_file_list(&mut *dev, &mut entry_points) };
            // SAFETY: `dev` is valid; recycle traffics in raw `*mut HotReloadEvent`.
            match unsafe { (*dev).watcher_atomics.recycle_event_from_dev_server(current) } {
                Some(next) => {
                    current = next;
                    #[cfg(debug_assertions)]
                    {
                        // SAFETY: `current` is a live event we now exclusively own.
                        debug_assert!(unsafe { (*current).debug_mutex.try_lock() });
                    }
                }
                None => break,
            }
        }

        // SAFETY: `dev` is valid; re-borrow after the raw-ptr loop.
        let dev_ref = unsafe { &mut *dev };

        if entry_points.set.count() == 0 {
            return;
        }

        match &mut dev_ref.testing_batch_events {
            TestingBatchEvents::Disabled => {}
            TestingBatchEvents::Enabled(ev) => {
                bun_core::handle_oom(ev.append(&entry_points));
                dev_ref.publish(
                    HmrTopic::TestingWatchSynchronization,
                    &[MessageId::TestingWatchSynchronization.char(), 1],
                    bun_uws::Opcode::BINARY,
                );
                return;
            }
            TestingBatchEvents::EnableAfterBundle => debug_assert!(false),
        }

        if let Err(_err) = dev_ref.start_async_bundle(entry_points, true, timer) {
            // PORT NOTE: Zig `bun.handleErrorReturnTrace` has no Rust equivalent.
            return;
        }
    }
}

impl DevServer {
    /// Spec DevServer.zig `onPluginsRejected` — plugin-load failure hook
    /// called from `ServePlugins::handle_on_reject`. Full body (mark all
    /// pending bundles failed, broadcast HMR error) lives in the gated draft.
    pub fn on_plugins_rejected(&mut self) {
        todo!("blocked_on: bake::DevServer::on_plugins_rejected body")
    }

    /// Spec DevServer.zig `emitMemoryVisualizerMessageTimer` — periodic
    /// memory-visualizer push to connected HMR sockets. Called from the
    /// high-tier `EventLoopTimer` dispatch with the raw `*EventLoopTimer`
    /// (Zig recovers `*DevServer` via `@fieldParentPtr`).
    pub fn emit_memory_visualizer_message_timer(
        _t: &mut bun_event_loop::EventLoopTimer::EventLoopTimer,
        _now: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        todo!("blocked_on: bake::DevServer::emit_memory_visualizer_message_timer body")
    }
}

/// `DevServer.WatcherAtomics` — three pre-allocated `HotReloadEvent`s
/// rotated between the watcher thread and the main thread.
pub struct WatcherAtomics {
    pub events: [HotReloadEvent; 3],
    /// `next_event: std.atomic.Value(NextEvent)` — encodes the `NextEvent`
    /// `enum(u8) { 0..3 = event index, .waiting, .done }`.
    // TODO(port): Zig had `align(std.atomic.cache_line)` on this field; Rust cannot align
    // individual fields — wrap in a `#[repr(align(128))]` newtype in Phase B if false sharing
    // shows up in profiles.
    pub next_event: core::sync::atomic::AtomicU8,
    /// Watcher-thread-only; index into `events` currently being processed.
    pub current_event: Option<u8>,
    /// Watcher-thread-only; index into `events` queued behind `current_event`.
    pub pending_event: Option<u8>,
    // Debug fields to ensure methods are being called in the right order.
    #[cfg(debug_assertions)]
    pub dbg_watcher_event: Option<*mut HotReloadEvent>,
    #[cfg(debug_assertions)]
    pub dbg_server_event: Option<*mut HotReloadEvent>,
}

/// Stored in `WatcherAtomics::next_event` (an `AtomicU8`). Modeled as a
/// transparent newtype rather than a `#[repr(u8)] enum` because Zig used an
/// open enum (`_`) where any other value is an index into the `events` array,
/// and Rust enums cannot hold unlisted discriminants.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct NextEvent(pub u8);

impl NextEvent {
    /// An event is running, and no next event is pending.
    pub const WAITING: NextEvent = NextEvent(u8::MAX - 1);
    /// No event is running.
    pub const DONE: NextEvent = NextEvent(u8::MAX);
    // Any other value represents an index into the `events` array.
}

impl WatcherAtomics {
    /// Called by DevServer after it receives a task callback. If this returns
    /// another event, that event should be passed again to this function, and
    /// so on, until this function returns `None`.
    ///
    /// Runs on dev server thread.
    pub fn recycle_event_from_dev_server(
        &mut self,
        old_event: *mut HotReloadEvent,
    ) -> Option<*mut HotReloadEvent> {
        // SAFETY: `old_event` was previously submitted to the dev server thread and is now
        // exclusively owned by it for reset.
        unsafe { (*old_event).reset() };

        #[cfg(debug_assertions)]
        {
            // Not atomic because watcher won't modify this value while an event is running.
            let dbg_event = self.dbg_server_event;
            self.dbg_server_event = None;
            debug_assert!(
                dbg_event == Some(old_event),
                "recycleEventFromDevServer: old_event: expected {:?}, got {:p}",
                dbg_event,
                old_event,
            );
        }

        let event: *mut HotReloadEvent = loop {
            let next = NextEvent(self.next_event.swap(NextEvent::WAITING.0, Ordering::AcqRel));
            match next {
                NextEvent::WAITING => {
                    // Success order is not AcqRel because the swap above performed an Acquire load.
                    // Failure order is Relaxed because we're going to perform an Acquire load
                    // in the next loop iteration.
                    if self
                        .next_event
                        .compare_exchange_weak(
                            NextEvent::WAITING.0,
                            NextEvent::DONE.0,
                            Ordering::Release,
                            Ordering::Relaxed,
                        )
                        .is_err()
                    {
                        continue; // another event may have been added
                    }
                    return None; // done running events
                }
                NextEvent::DONE => unreachable!(),
                _ => break &mut self.events[next.0 as usize],
            }
        };

        #[cfg(debug_assertions)]
        {
            // Not atomic because watcher won't modify this value while an event is running.
            self.dbg_server_event = Some(event);
        }
        Some(event)
    }

    /// Atomically get a `*mut HotReloadEvent` that is not in use by the
    /// DevServer thread. Call `watcher_release_and_submit_event` when it is
    /// filled with files.
    ///
    /// Called from watcher thread.
    pub fn watcher_acquire_event(&mut self) -> *mut HotReloadEvent {
        let mut available = [true; 3];
        if let Some(i) = self.current_event {
            available[i as usize] = false;
        }
        if let Some(i) = self.pending_event {
            available[i as usize] = false;
        }

        let index = 'find: {
            for (i, &is_available) in available.iter().enumerate() {
                if is_available {
                    break 'find i;
                }
            }
            unreachable!()
        };
        let ev: *mut HotReloadEvent = &mut self.events[index];

        #[cfg(debug_assertions)]
        {
            debug_assert!(
                self.dbg_watcher_event.is_none(),
                "must call `watcherReleaseEvent` before calling `watcherAcquireEvent` again",
            );
            self.dbg_watcher_event = Some(ev);
        }

        // SAFETY: `ev` points into `self.events[index]`, which the watcher thread has exclusive
        // access to (it is neither `current_event` nor `pending_event`).
        let ev_ref = unsafe { &mut *ev };

        // Initialize the timer if it is empty.
        if ev_ref.is_empty() {
            // PORT NOTE: Zig's `std.time.Timer.start()` records a monotonic start time;
            // we capture `Instant::now()` here and compute elapsed at the read site.
            ev_ref.timer = std::time::Instant::now();
        }

        // SAFETY: `owner` is a BACKREF to the DevServer that owns the WatcherAtomics array
        // containing this event; DevServer outlives all HotReloadEvents it holds.
        unsafe { (*ev_ref.owner).bun_watcher.thread_lock.assert_locked() };

        #[cfg(debug_assertions)]
        debug_assert!(ev_ref.debug_mutex.try_lock());

        ev
    }

    /// Release the pointer from `watcher_acquire_event`, submitting the event
    /// if it contains new files.
    ///
    /// Called from watcher thread.
    pub fn watcher_release_and_submit_event(&mut self, ev: *mut HotReloadEvent) {
        // SAFETY: `ev` was returned by `watcher_acquire_event` and points into `self.events`;
        // the watcher thread has exclusive access until it is submitted below.
        let ev_ref = unsafe { &mut *ev };

        // SAFETY: `owner` is a BACKREF to the DevServer; valid for the event's lifetime.
        unsafe { (*ev_ref.owner).bun_watcher.thread_lock.assert_locked() };

        #[cfg(debug_assertions)]
        {
            let Some(dbg_event) = self.dbg_watcher_event else {
                panic!("must call `watcherAcquireEvent` before `watcherReleaseAndSubmitEvent`");
            };
            debug_assert!(
                dbg_event == ev,
                "watcherReleaseAndSubmitEvent: event is not from last `watcherAcquireEvent` call \
                 (expected {:p}, got {:p})",
                dbg_event,
                ev,
            );
            self.dbg_watcher_event = None;
        }

        #[cfg(debug_assertions)]
        {
            // TODO(port): Zig checked that `ev.timer` was not the 0xAA undefined-memory pattern.
            // Rust has no equivalent debug-undefined fill; this check is a no-op here. Kept as a
            // structural marker for Phase B review.
            // SAFETY: reading initialized bytes of `timer` for a debug sanity check.
            let bytes = unsafe {
                core::slice::from_raw_parts(
                    core::ptr::addr_of!(ev_ref.timer) as *const u8,
                    core::mem::size_of_val(&ev_ref.timer),
                )
            };
            let mut all_aa = true;
            for &b in bytes {
                if b != 0xAA {
                    all_aa = false;
                    break;
                }
            }
            if all_aa {
                panic!("timer is undefined memory in watcherReleaseAndSubmitEvent");
            }
            ev_ref.debug_mutex.unlock();
        }

        if ev_ref.is_empty() {
            return;
        }
        // There are files to be processed.

        // SAFETY: `ev` points into `self.events`; both are within the same allocation.
        let ev_index: u8 = u8::try_from(unsafe {
            ev.offset_from(self.events.as_ptr() as *mut HotReloadEvent)
        })
        .unwrap();
        let old_next = NextEvent(self.next_event.swap(ev_index, Ordering::AcqRel));
        match old_next {
            NextEvent::DONE => {
                // Dev server is done running events. We need to schedule the event directly.
                self.current_event = Some(ev_index);
                self.pending_event = None;
                // Relaxed because the dev server is not running events right now.
                // (could technically be made non-atomic)
                self.next_event.store(NextEvent::WAITING.0, Ordering::Relaxed);
                #[cfg(debug_assertions)]
                {
                    debug_assert!(
                        self.dbg_server_event.is_none(),
                        "no event should be running right now",
                    );
                    // Not atomic because the dev server is not running events right now.
                    self.dbg_server_event = Some(ev);
                }
                ev_ref.concurrent_task = bun_event_loop::ConcurrentTask::ConcurrentTask {
                    task: bun_event_loop::Task::init(ev),
                    ..Default::default()
                };
                // SAFETY: `owner` BACKREF is valid; `vm` is JSC_BORROW valid for DevServer's
                // lifetime; `event_loop` points at a sibling field of `VirtualMachine`.
                unsafe {
                    (*(*(*ev_ref.owner).vm).event_loop)
                        .enqueue_task_concurrent(&mut ev_ref.concurrent_task);
                }
            }

            NextEvent::WAITING => {
                if self.pending_event.is_some() {
                    // `pending_event` is running, which means we're done with `current_event`.
                    self.current_event = self.pending_event;
                } // else, no pending event yet, but not done with `current_event`.
                self.pending_event = Some(ev_index);
            }

            _ => {
                // This is an index into the `events` array.
                let old_index: u8 = old_next.0;
                debug_assert!(
                    self.pending_event == Some(old_index),
                    "watcherReleaseAndSubmitEvent: expected `pending_event` to be {}; got {:?}",
                    old_index,
                    self.pending_event,
                );
                // The old pending event hadn't been run yet, so we can replace it with `ev`.
                self.pending_event = Some(ev_index);
            }
        }
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
    /// `@fieldParentPtr("directory_watchers", self)` — recover `*mut DevServer`.
    /// Returns a raw ptr (not `&mut DevServer`) because `&mut self` is live;
    /// callers must scope their borrow of fields disjoint from
    /// `directory_watchers` to avoid aliasing UB.
    #[inline]
    fn owner(&mut self) -> *mut DevServer {
        // SAFETY: `DirectoryWatchStore` is only ever the `directory_watchers`
        // field of a heap-allocated `DevServer` (never moved post-init).
        unsafe {
            (self as *mut Self)
                .cast::<u8>()
                .sub(core::mem::offset_of!(DevServer, directory_watchers))
                .cast::<DevServer>()
        }
    }

    /// `DirectoryWatchStore.freeDependencyIndex` — DirectoryWatchStore.zig.
    pub fn free_dependency_index(&mut self, index: u32) {
        // Zero out the slot so DevServer.deinit/memoryCost — which iterate
        // `dependencies` without consulting the free list — do not touch the
        // freed allocation or stale borrowed pointers.
        self.dependencies[index as usize] = directory_watch_store::Dep::default();
        if index as usize == self.dependencies.len() - 1 {
            self.dependencies.truncate(self.dependencies.len() - 1);
        } else {
            self.dependencies_free_list.push(index);
        }
    }

    /// `DirectoryWatchStore.freeEntry` — DirectoryWatchStore.zig:206.
    /// Expects dependency list to be already freed.
    pub fn free_entry(&mut self, entry_index: usize) {
        let entry = self.watches.values()[entry_index];

        bun_core::scoped_log!(DevServer, "DirectoryWatchStore.freeEntry({}, {:?})", entry_index, entry.dir);

        // SAFETY: owner() returns a *mut DevServer; `bun_watcher` is a disjoint
        // field from `directory_watchers` so this does not alias `&mut self`.
        unsafe {
            (*self.owner()).bun_watcher.remove_at_index(
                bun_watcher::WatchItemKind::File,
                entry.watch_index,
                0,
                &[],
            );
        }

        // Zig: alloc.free(store.watches.keys()[entry_index]) — Box key drops on swap_remove_at.
        let _ = self.watches.swap_remove_at(entry_index);

        if entry.dir_fd_owned {
            entry.dir.close();
        }

        if self.watches.len() == 0 {
            // Every remaining dependency slot must be in the free list.
            debug_assert_eq!(self.dependencies.len(), self.dependencies_free_list.len());
            self.dependencies.clear();
            self.dependencies_free_list.clear();
        }
    }
}
pub mod directory_watch_store {
    /// `DirectoryWatchStore.Entry` — per-watched-directory state.
    #[derive(Copy, Clone)]
    pub struct Entry {
        /// The directory handle the watch is placed on.
        pub dir: bun_sys::Fd,
        pub dir_fd_owned: bool,
        /// `Dep.Index` — head of the singly-linked dep chain for this dir.
        pub first_dep: u32,
        /// To pass to `Watcher.remove`.
        pub watch_index: u16,
    }
    /// `DirectoryWatchStore.Dep` — one resolution-failure to retry on dir change.
    pub struct Dep {
        pub next: Option<u32>,
        /// The file used. BORROWED slice into `IncrementalGraph.bundled_files`
        /// key storage; compared by *pointer identity* (Zig: `dep.source_file_path.ptr == file_path.ptr`).
        // SAFETY: lifetime tied to `IncrementalGraph` key storage; cleared via
        // `removeDependenciesForFile` before the graph frees the key.
        pub source_file_path: *const [u8],
        /// The specifier that failed. Allocated memory.
        pub specifier: Box<[u8]>,
    }
    impl Default for Dep {
        fn default() -> Self {
            Dep {
                next: None,
                source_file_path: &[] as *const [u8],
                specifier: Box::default(),
            }
        }
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
    pub client_graph: IncrementalGraph<{ Side::Client }>,
    pub server_graph: IncrementalGraph<{ Side::Server }>,
    pub barrel_files_with_deferrals: StringArrayHashMap<()>,
    pub barrel_needed_exports: StringArrayHashMap<StringHashMap<()>>,
    pub incremental_result: IncrementalResult,
    pub route_lookup: ArrayHashMap<incremental_graph::ServerFileIndex, RouteIndexAndRecurseFlag>,
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
    pub dump_dir: Option<bun_sys::Dir>,
    pub emit_incremental_visualizer_events: u32,
    pub emit_memory_visualizer_events: u32,
    pub memory_visualizer_timer: EventLoopTimer,

    pub has_pre_crash_handler: bool,
    pub assume_perfect_incremental_bundling: bool,
    pub broadcast_console_log_from_browser_to_server: bool,
}

impl DevServer {
    /// `DevServer.publish` — DevServer.zig:4163.
    pub fn publish(&self, topic: HmrTopic, message: &[u8], opcode: bun_uws::Opcode) {
        if let Some(s) = &self.server {
            let _ = s.publish(&[topic as u8], message, opcode, false);
        }
    }

    /// `DevServer.numSubscribers` — DevServer.zig:4167.
    pub fn num_subscribers(&self, topic: HmrTopic) -> u32 {
        match &self.server {
            Some(s) => s.num_subscribers(&[topic as u8]),
            None => 0,
        }
    }

    // `DevServer.startAsyncBundle` — real body lives in `lifecycle.rs`.

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

    // PORT NOTE: `devAllocator()` (DevServer.zig:273) is intentionally not
    // mirrored here — Rust collections in this module use the global mimalloc,
    // so no callsite needs the borrowed `AllocationScope` handle. The real
    // accessor lives on the lifetime-carrying `dev_server_body::DevServer`.

    /// `DevServer.emitMemoryVisualizerMessageIfNeeded` -- DevServer.zig:4341.
    /// Full body lives in the gated `../DevServer.rs` draft (depends on
    /// `HmrSocket::publish` + `memory_cost_detailed`). Sub-stores call this
    /// after structural mutations so the inspector tab refreshes.
    pub fn emit_memory_visualizer_message_if_needed(&mut self) {
        if self.emit_memory_visualizer_events == 0 {
            return;
        }
        todo!("blocked_on: dev_server::DevServer::emit_memory_visualizer_message_if_needed body un-gate")
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
        // PORT NOTE: arms duplicated because `client_graph` / `server_graph`
        // are distinct const-generic instantiations.
        fn check<const S: Side>(g: &IncrementalGraph<S>, path: &[u8]) -> Option<CacheEntry> {
            g.bundled_files.get_index(path).and_then(|index| {
                (!g.stale_files.is_set(index)).then(|| CacheEntry { kind: g.file_kind_at(index) })
            })
        }
        let r = match side {
            Graph::Client => check(&self.client_graph, path),
            Graph::Server | Graph::Ssr => check(&self.server_graph, path),
        };
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
            // Vtable slot already passes `bake_types::Graph` (DevServer.zig:2128
            // takes `bake.Graph`); no widening needed.
            dev.is_file_cached(abs_path, side).map(|e| {
                bun_bundler::bake_types::CacheEntry {
                    // SAFETY: FileKind/CacheKind have identical #[repr(u8)] discriminants.
                    kind: unsafe { core::mem::transmute::<FileKind, _>(e.kind) },
                }
            })
        },
        barrel_needed_exports: |_p| {
            // DevServer field is `StringArrayHashMap<StringHashMap<()>>` but the
            // vtable slot expects `*mut StringHashMap<StringHashMap<()>>` —
            // mismatched container kinds; bundler side must adapt.
            todo!("blocked_on: bun_bundler::dispatch::DevServerVTable::barrel_needed_exports container kind")
        },
        log_for_resolution_failures: |_p, _abs_path, _graph| {
            todo!("blocked_on: dev_server_body::DevServer::log_for_resolution_failures un-gate")
        },
        finalize_bundle: |_p, _bv2, _result| {
            todo!("blocked_on: dev_server_body::DevServer::finalize_bundle un-gate")
        },
        handle_parse_task_failure: |_p, _err, _graph, _abs_path, _log, _bv2| {
            todo!("blocked_on: dev_server_body::DevServer::handle_parse_task_failure un-gate")
        },
        put_or_overwrite_asset: |_p, _path, _contents, _hash| {
            todo!("blocked_on: dev_server::Assets::put_or_overwrite un-gate")
        },
        track_resolution_failure: |_p, _import_source, _specifier, _graph, _loader| {
            todo!("blocked_on: dev_server_body::DevServer::track_resolution_failure un-gate")
        },
        asset_hash: |p, abs_path| {
            // SAFETY: p is a live *mut DevServer per DevServerHandle invariant.
            let dev = unsafe { &mut *p.cast::<DevServer>() };
            let _ = (dev, abs_path);
            todo!("blocked_on: dev_server::Assets::get_hash un-gate")
        },
        current_bundle_start_data: |p| {
            // SAFETY: p is a live *mut DevServer per DevServerHandle invariant.
            let dev = unsafe { &mut *p.cast::<DevServer>() };
            dev.current_bundle
                .as_mut()
                .map(|c| c.start_data)
                .unwrap_or(core::ptr::null_mut())
        },
        register_barrel_with_deferrals: |p, path| {
            // SAFETY: p is a live *mut DevServer per DevServerHandle invariant.
            let dev = unsafe { &mut *p.cast::<DevServer>() };
            let _ = dev
                .barrel_files_with_deferrals
                .get_or_put(path)
                .map_err(|_| bun_alloc::out_of_memory());
            Ok(())
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

// ──────────────────────────────────────────────────────────────────────────
// HmrSocket-facing DevServer surface (bodies gated in `../DevServer.rs`)
// ──────────────────────────────────────────────────────────────────────────
impl DevServer {
    /// Length of `configuration_hash_key` — Zig: `[16]u8`.
    pub const CONFIGURATION_HASH_KEY_LEN: usize = 16;

    /// `DevServer.inspector()` — DevServer.zig:4031. Returns the JS-side
    /// inspector agent if a debugger is attached and the frontend agent is
    /// enabled. Full body in gated `../DevServer.rs` draft (depends on
    /// `bun_jsc::VirtualMachine::debugger` field surface).
    ///
    /// SAFETY: returns `&mut BunFrontendDevServerAgent` derived through the
    /// `UnsafeCell` on `Debugger.frontend_dev_server_agent`; two calls alias
    /// the same agent. Caller must not hold another live `&mut` to it.
    /// JS-thread only.
    #[allow(clippy::missing_safety_doc)]
    pub unsafe fn inspector(
        &self,
    ) -> Option<&mut crate::server::inspector_bun_frontend_dev_server_agent::BunFrontendDevServerAgent>
    {
        // TODO(b2-blocked): `bun_jsc::Debugger.frontend_dev_server_agent` stores
        // the low-tier stub, not the runtime `BunFrontendDevServerAgent`.
        // Return `None` until the agent storage is unified.
        None
    }

    /// `DevServer.routeToBundleIndexSlow`. Full body in gated `../DevServer.rs`
    /// draft (depends on `FrameworkRouter::match_slow` + `html_router`).
    pub fn route_to_bundle_index_slow(&mut self, _pattern: &[u8]) -> Option<route_bundle::Index> {
        todo!("blocked_on: dev_server::DevServer::route_to_bundle_index_slow body un-gate")
    }

    /// `DevServer.emitVisualizerMessageIfNeeded`. Full body in gated
    /// `../DevServer.rs` draft.
    pub fn emit_visualizer_message_if_needed(&mut self) {
        todo!("blocked_on: dev_server::DevServer::emit_visualizer_message_if_needed body un-gate")
    }

    /// `DevServer.emitMemoryVisualizerMessage`. Full body in gated
    /// `../DevServer.rs` draft.
    pub fn emit_memory_visualizer_message(&mut self) {
        todo!("blocked_on: dev_server::DevServer::emit_memory_visualizer_message body un-gate")
    }
}

// ─── Shims added for incremental_graph_body (Phase-D) ────────────────────────
impl EntryPointList {
    /// `EntryPointList.appendJs` — DevServer.zig.
    pub fn append_js(&mut self, abs_path: &[u8], side: Graph) -> Result<(), bun_core::Error> {
        let flag = match side {
            Graph::Client => entry_point_list::Flags::CLIENT,
            Graph::Server => entry_point_list::Flags::SERVER,
            Graph::Ssr => entry_point_list::Flags::SSR,
        };
        let gop = bun_core::handle_oom(self.set.get_or_put(abs_path));
        if gop.found_existing { *gop.value_ptr |= flag; } else { *gop.value_ptr = flag; }
        Ok(())
    }
}
impl DevServer {
    /// `DevServer.relativePath` — DevServer.zig:4225.
    pub fn relative_path<'a>(
        &self,
        relative_path_buf: &'a mut bun_paths::PathBuffer,
        path: &'a [u8],
    ) -> &'a [u8] {
        if !bun_paths::is_absolute(path) {
            return path;
        }

        if path.len() >= self.root.len() + 1
            && path[self.root.len()] == b'/'
            && path.starts_with(&*self.root)
        {
            return &path[self.root.len() + 1..];
        }

        let rel = bun_paths::resolve_path::relative_platform_buf::<
            bun_paths::resolve_path::platform::Auto,
            true,
        >(&mut relative_path_buf[..], &self.root, path);
        // SAFETY: `rel` borrows `relative_path_buf`, which is exclusively owned
        // by the caller; in-place mutation only flips path separators.
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(unsafe {
            core::slice::from_raw_parts_mut(rel.as_ptr() as *mut u8, rel.len())
        });
        rel
    }
}
impl DirectoryWatchStore {
    /// `DirectoryWatchStore.removeDependenciesForFile` — DirectoryWatchStore.zig:233.
    /// Removes all dependencies whose `source_file_path` is the exact slice
    /// `file_path`, compared by *pointer identity* since the slice is shared
    /// with `IncrementalGraph.bundled_files`. Called before IncrementalGraph
    /// frees a file's key string so no `Dep` is left holding a dangling pointer.
    pub fn remove_dependencies_for_file(&mut self, file_path: &[u8]) {
        if self.watches.count() == 0 {
            return;
        }

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.removeDependenciesForFile({:?})",
            bstr::BStr::new(file_path),
        );

        // Iterate in reverse since `free_entry` uses `swap_remove_at`.
        let mut watch_index = self.watches.count();
        while watch_index > 0 {
            watch_index -= 1;
            // PORT NOTE: reshaped for borrowck — cannot hold &mut entry across
            // self.free_dependency_index(); walk by index and re-borrow.
            let mut new_chain: Option<u32> = None;
            let mut it: Option<u32> = Some(self.watches.values()[watch_index].first_dep);
            while let Some(index) = it {
                let dep_next = self.dependencies[index as usize].next;
                let dep_ptr = self.dependencies[index as usize].source_file_path;
                it = dep_next;
                // SAFETY: `source_file_path` is a raw fat ptr stored for identity comparison only.
                if unsafe { (*dep_ptr).as_ptr() } == file_path.as_ptr() {
                    self.free_dependency_index(index);
                } else {
                    self.dependencies[index as usize].next = new_chain;
                    new_chain = Some(index);
                }
            }
            if let Some(new_first_dep) = new_chain {
                self.watches.values_mut()[watch_index].first_dep = new_first_dep;
            } else {
                self.free_entry(watch_index);
            }
        }
    }
}
