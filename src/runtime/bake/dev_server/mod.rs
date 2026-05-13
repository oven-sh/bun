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

use core::sync::atomic::Ordering;

use core::ptr::NonNull;

use bun_collections::{HashMap, StringArrayHashMap, bit_set::DynamicBitSet};
use bun_sys::FdExt as _;

use super::framework_router::{self, OpaqueFileId};
use super::jsc;
use super::{Graph, Side};
use crate::server::StaticRoute;

// ─── gated Phase-A submodule drafts (full bodies preserved) ──────────────────
// Each draft is a faithful port of the `.zig` sibling but depends on
// `bun_jsc` method surface and/or `bun_bundler::BundleV2` field access.
// Assets body draft dissolved into `assets.rs`.
#[path = "../DevServer/DirectoryWatchStore.rs"]
pub(crate) mod directory_watch_store_body;
#[path = "../DevServer/ErrorReportRequest.rs"]
pub(crate) mod error_report_request_body;
#[path = "../DevServer/HmrSocket.rs"]
pub(crate) mod hmr_socket_body;
// HotReloadEvent body draft dissolved into this file (see struct + impl below).
#[path = "../DevServer/IncrementalGraph.rs"]
pub(crate) mod incremental_graph_body;
// PackedMap body draft dissolved into `packed_map.rs`.
#[path = "../DevServer/RouteBundle.rs"]
pub(crate) mod route_bundle_body;
// SerializedFailure body draft dissolved into `serialized_failure.rs`.
// SourceMapStore body draft dissolved into `source_map_store.rs`.
#[path = "../DevServer/memory_cost.rs"]
pub(crate) mod memory_cost_body;
#[path = "../DevServer/WatcherAtomics.rs"]
pub(crate) mod watcher_atomics_body;

// NOTE: the `DevServer` scoped-log static (`ScopedLogger`) is declared in
// `dev_server_body` (`bun_output::declare_scope!(DevServer, visible)`) and
// re-exported via the `pub use` block below alongside the `struct DevServer`
// type. Declaring it again here would collide in the value namespace.

pub const INTERNAL_PREFIX: &str = "/_bun";
pub const ASSET_PREFIX: &str = "/_bun/asset";
pub const CLIENT_PREFIX: &str = "/_bun/client";

/// `bun.jsc.Debugger.DevServerId`.
pub type DebuggerId = jsc::DebuggerId;

// LAYERING: the 4.8 kL of method bodies live in `../DevServer.rs` (mounted as
// `super::dev_server_body`). The struct definitions are owned there so impl
// blocks and `container_of` submodules name a single type. Re-export so
// `crate::bake::dev_server::DevServer` (the public path used by `server/`,
// `dispatch.rs`, …) resolves to that one struct.
pub use super::dev_server_body::{
    CacheEntry, CurrentBundle, DeferredPromise, DeferredRequest, DevServer, EntryPointList,
    HTMLRouter, Magic, NextBundle, Options, PluginState, RouteIndexAndRecurseFlag, TestingBatch,
    TestingBatchEvents, deferred_request, entry_point_list,
};

/// `DevServer.FileKind` — kept in lockstep with `bun_bundler::bake_types::CacheKind`
/// (the vtable boundary maps between them via an exhaustive match).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FileKind {
    Unknown = 0,
    Js = 1,
    Asset = 2,
    Css = 3,
}
impl FileKind {
    #[inline]
    pub fn has_inline_js_code_chunk(self) -> bool {
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
    #[inline]
    pub fn char(self) -> u8 {
        self as u8
    }
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

// ──────────────────────────────────────────────────────────────────────────
// EventLoopTimer
// ──────────────────────────────────────────────────────────────────────────
pub use bun_event_loop::EventLoopTimer::{EventLoopTimer, Tag as TimerTag};

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
    #[inline]
    pub fn bits(&mut self, side: Side) -> &mut DynamicBitSet {
        match side {
            Side::Client => &mut self.client_bits,
            Side::Server => &mut self.server_bits,
        }
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
        self.client_bits
            .resize(0, false)
            .expect("freeing memory can not fail");
        self.server_bits
            .resize(0, false)
            .expect("freeing memory can not fail");
    }
}

pub use super::dev_server_body::init;

// ──────────────────────────────────────────────────────────────────────────
// Submodule types (struct shapes un-gated; method bodies stay in drafts)
// ──────────────────────────────────────────────────────────────────────────
pub mod assets;
pub mod incremental_graph;
mod lifecycle;
pub mod packed_map;
pub mod route_bundle;
pub mod serialized_failure;
pub mod source_map_store;

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
        (*self)
            .get_remote_socket_info()
            .map(|a| bun_uws::SocketAddress {
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
        let boxed = bun_core::heap::into_raw(Box::new(data));
        let _ = (*self).upgrade(
            boxed,
            sec_web_socket_key,
            sec_web_socket_protocol,
            sec_web_socket_extensions,
            Some(ctx),
        );
    }
}

/// `DevServer.HmrSocket` — per-WebSocket state. Method bodies (open/close/
/// message handlers) live in `hmr_socket_body` (`../DevServer/HmrSocket.rs`).
pub struct HmrSocket {
    /// BACKREF: owned by `dev.active_websocket_connections`; destroyed via
    /// `remove` + `heap::take` in `on_close`.
    pub dev: bun_ptr::BackRef<DevServer>,
    pub underlying: Option<bun_uws::AnyWebSocket>,
    pub subscriptions: super::dev_server_body::HmrTopicBits,
    /// Allows actions which inspect or mutate sensitive DevServer state.
    pub is_from_localhost: bool,
    /// By telling DevServer the active route, this enables receiving detailed
    /// `hot_update` events for when the route is updated.
    pub active_route: route_bundle::IndexOptional,
    /// Source-map keys this socket has been sent; used to ref-count entries
    /// in `SourceMapStore` so they survive until the socket disconnects.
    pub referenced_source_maps: HashMap<source_map_store::Key, ()>,
    pub inspector_connection_id: i32,
}

impl HmrSocket {
    /// `subscriptions` is a packed `HmrTopicBits` value; test the bit for a
    /// given topic.
    #[inline]
    pub fn is_subscribed(&self, topic: HmrTopic) -> bool {
        self.subscriptions.contains(topic.as_bit())
    }
}

/// `DevServer.HotReloadEvent` — produced by the watcher thread.
// PORT NOTE: Zig's `_: u0 align(std.atomic.cache_line) = 0` first-field trick gives the whole
// struct cache-line alignment so each inline `WatcherAtomics.events: [3]` element occupies its
// own cache line, avoiding false sharing on `contention_indicator` between watcher and dev-server
// threads. 128 matches `std.atomic.cache_line` on x86_64/aarch64 (Bun's tier-1 targets) and
// absorbs Intel adjacent-line prefetch.
#[repr(align(128))]
pub struct HotReloadEvent {
    /// BACKREF (LIFETIMES.tsv): inline element of `WatcherAtomics.events: [3]`.
    /// `*mut` (not `*const`) because `run` mutates the owning DevServer; Zig
    /// declares `owner: *DevServer`.
    pub owner: *mut DevServer,
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
    pub fn init_empty(owner: *mut DevServer) -> HotReloadEvent {
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

    /// Debug-asserts that the owning [`DevServer`]'s watcher thread-lock is
    /// held. Centralises the back-ref deref so the four call sites in
    /// `watcher_acquire_event` / `watcher_release_and_submit_event` (both the
    /// `WatcherAtomics` impl here and the duplicate in
    /// `DevServer/WatcherAtomics.rs`) stay safe.
    #[inline]
    pub fn assert_watcher_thread_locked(&self) {
        // SAFETY: BACKREF — `owner` is the DevServer whose
        // `watcher_atomics.events` array contains `self`; DevServer outlives
        // every HotReloadEvent it holds. Raw place projection (no `&DevServer`
        // intermediate) so this does not alias any live `&mut HotReloadEvent`.
        // `bun_watcher` is field-disjoint from `watcher_atomics`.
        unsafe { (*self.owner).bun_watcher.thread_lock.assert_locked() };
    }

    /// `HotReloadEvent.processFileList` — HotReloadEvent.zig:78.
    /// Invalidates items in IncrementalGraph, appending all new items to `entry_points`.
    pub fn process_file_list(&mut self, dev: &mut DevServer, entry_points: &mut EntryPointList) {
        // RAII: `ThreadLockGuard` stores a raw `*const ThreadLock` and unlocks on
        // drop, so it does not hold a borrow of `dev` for the scope.
        let _g = dev.graph_safety_lock.guard();

        // First handle directories, because this may mutate `event.files`
        if dev.directory_watchers.watches.count() > 0 {
            for changed_dir_with_slash in self.dirs.keys() {
                let changed_dir = bun_paths::string_paths::without_trailing_slash_windows_path(
                    changed_dir_with_slash,
                );

                // Bust resolution cache, but since Bun does not watch all
                // directories in a codebase, this only targets the following resolutions
                // SAFETY: server_transpiler is initialized in DevServer::init before any
                // HotReloadEvent can fire.
                let _ = unsafe { dev.server_transpiler.assume_init_mut() }
                    .resolver
                    .bust_dir_cache(changed_dir);

                // if a directory watch exists for resolution failures, check those now.
                if let Some(watcher_index) = dev.directory_watchers.watches.get_index(changed_dir) {
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
                            (dep.source_file_path, &raw const *dep.specifier, dep.next)
                        };
                        it = next;

                        // `specifier` points into the dep's owned `Box<[u8]>`, which is
                        // not mutated until after `resolve` returns.
                        // SAFETY: see `Dep` doc — neither slice is mutated mid-resolve.
                        let resolved = unsafe { dev.server_transpiler.assume_init_mut() }
                            .resolver
                            .resolve(
                                bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                    source_file_path.slice(),
                                ),
                                unsafe { &*specifier },
                                bun_ast::ImportKind::Stmt,
                            )
                            .is_ok();

                        if resolved {
                            // this resolution result is not preserved as passing it
                            // into BundleV2 is too complicated. the resolution is
                            // cached, anyways.
                            // PORT NOTE: inlined `append_file` body for disjoint borrow
                            // (`self.dirs.keys()` is held immutably across this loop).
                            bun_core::handle_oom(self.files.get_or_put(source_file_path.slice()));
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
        while let Some(str_idx) = bun_core::index_of_char(rest_extra, 0) {
            bun_core::handle_oom(self.files.put(&rest_extra[0..str_idx as usize], ()));
            rest_extra = &rest_extra[str_idx as usize + 1..];
        }
        if !rest_extra.is_empty() {
            bun_core::handle_oom(self.files.put(rest_extra, ()));
        }

        let changed_file_paths = self.files.keys();
        // PORT NOTE: Zig used `inline for` over a 2-tuple; written out as two calls.
        bun_core::handle_oom(
            dev.server_graph
                .invalidate(changed_file_paths, entry_points),
        );
        bun_core::handle_oom(
            dev.client_graph
                .invalidate(changed_file_paths, entry_points),
        );

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

    /// `HotReloadEvent.appendFile` — HotReloadEvent.zig:55.
    pub fn append_file(&mut self, file_path: &[u8]) {
        bun_core::handle_oom(self.files.get_or_put(file_path));
    }

    /// `HotReloadEvent.appendDir` — HotReloadEvent.zig:58.
    pub fn append_dir(&mut self, dir_path: &[u8], maybe_sub_path: Option<&[u8]>) {
        if dir_path.is_empty() {
            return;
        }
        bun_core::handle_oom(self.dirs.get_or_put(dir_path));

        let Some(sub_path) = maybe_sub_path else {
            return;
        };
        if sub_path.is_empty() {
            return;
        }

        let ends_with_sep = bun_paths::Platform::AUTO.is_separator(dir_path[dir_path.len() - 1]);
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
    ///
    /// Takes a raw `*mut` because `first` is an inline element of
    /// `(*first.owner).watcher_atomics.events[_]`; holding a `&mut HotReloadEvent`
    /// parameter while also materialising `&mut DevServer` would create two
    /// aliasing unique borrows. All event accesses go through the raw pointer
    /// and `&mut DevServer` is re-borrowed per use, scoped to not overlap any
    /// live `&mut *current`.
    ///
    /// # Safety
    /// `first` must point at a live `HotReloadEvent` owned by
    /// `(*first).owner.watcher_atomics.events`, and this fn must run on the
    /// DevServer thread (sole mutator of `*owner` outside `watcher_atomics`).
    pub unsafe fn run(first: *mut HotReloadEvent) {
        // SAFETY: caller contract — `first` is live; `owner` is a BACKREF to the
        // DevServer that owns the WatcherAtomics array containing this event;
        // DevServer outlives all HotReloadEvents it holds.
        let dev: *mut DevServer = unsafe { (*first).owner };
        // SAFETY: see above; `magic` read is non-aliasing.
        debug_assert!(unsafe { (*dev).magic } == Magic::Valid);
        bun_core::scoped_log!(DevServer, "HMR Task start");
        scopeguard::defer! {
            bun_core::scoped_log!(DevServer, "HMR Task end");
        }

        #[cfg(debug_assertions)]
        {
            // SAFETY: `first` is live and exclusively owned by this thread.
            debug_assert!(unsafe { (*first).debug_mutex.try_lock() });
            debug_assert!(unsafe { (*first).contention_indicator.load(Ordering::SeqCst) } == 0);
        }

        // SAFETY: `dev` is the unique BACKREF; this fn runs on the DevServer
        // thread. No `&mut *first` is live across this borrow.
        if unsafe { (*dev).current_bundle.is_some() } {
            // SAFETY: as above; `next_bundle` is disjoint from `watcher_atomics`.
            unsafe { (*dev).next_bundle.reload_event = Some(first) };
            return;
        }

        // PERF(port): was stack-fallback allocator (4096 bytes) — profile in Phase B
        let mut entry_points = EntryPointList::default();

        // SAFETY: `first` is live; `&mut *dev` re-borrowed for the call only.
        // `process_file_list` mutates graph/watcher/transpiler fields of `dev`,
        // all disjoint from `dev.watcher_atomics.events[_]` (where `first` lives).
        unsafe { (*first).process_file_list(&mut *dev, &mut entry_points) };

        // SAFETY: `first` is live; `timer` was set by
        // `WatcherAtomics::watcher_acquire_event` before submission.
        let timer = unsafe { (*first).timer };

        // PORT NOTE: raw-ptr loop because `recycle_event_from_dev_server` returns
        // a pointer into `dev.watcher_atomics.events`; re-borrow each iteration
        // to avoid aliasing UB.
        let mut current: *mut HotReloadEvent = first;
        loop {
            // SAFETY: `current` always points at a live event owned by
            // `dev.watcher_atomics`; `&mut *dev` re-borrowed for the call only,
            // disjoint per the note above.
            unsafe { (*current).process_file_list(&mut *dev, &mut entry_points) };
            // SAFETY: `dev` is valid; recycle traffics in raw `*mut HotReloadEvent`.
            match unsafe {
                (*dev)
                    .watcher_atomics
                    .recycle_event_from_dev_server(current)
            } {
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

        // SAFETY: `dev` is valid; no `&mut *current` is live past this point.
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
                _ => break &raw mut self.events[next.0 as usize],
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
        let ev: *mut HotReloadEvent = &raw mut self.events[index];

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

        ev_ref.assert_watcher_thread_locked();

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

        ev_ref.assert_watcher_thread_locked();

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
            // PORT NOTE: Zig asserted `ev.timer` was not the 0xAA debug-undefined
            // fill pattern. Rust has no such fill (uninitialized memory is never
            // observed through a typed place), so the byte-scan is dropped — it
            // could not fire and reading struct padding is itself UB.
            ev_ref.debug_mutex.unlock();
        }

        if ev_ref.is_empty() {
            return;
        }
        // There are files to be processed.

        // SAFETY: `ev` points into `self.events`; both are within the same allocation.
        let ev_index: u8 =
            u8::try_from(unsafe { ev.offset_from(self.events.as_ptr().cast_mut()) }).unwrap();
        let old_next = NextEvent(self.next_event.swap(ev_index, Ordering::AcqRel));
        match old_next {
            NextEvent::DONE => {
                // Dev server is done running events. We need to schedule the event directly.
                self.current_event = Some(ev_index);
                self.pending_event = None;
                // Relaxed because the dev server is not running events right now.
                // (could technically be made non-atomic)
                self.next_event
                    .store(NextEvent::WAITING.0, Ordering::Relaxed);
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
                // SAFETY: `owner` BACKREF is valid; `vm` is a `BackRef` (safe
                // Deref); `event_loop` points at a sibling field of `VirtualMachine`.
                unsafe {
                    (*(&(*ev_ref.owner).vm).event_loop)
                        .enqueue_task_concurrent(&raw mut ev_ref.concurrent_task);
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
    /// Intrusive backref: recover `*mut DevServer`.
    /// Returns a raw ptr (not `&mut DevServer`) because `&mut self` is live;
    /// callers must scope their borrow of fields disjoint from
    /// `directory_watchers` to avoid aliasing UB.
    #[inline]
    fn owner(&mut self) -> *mut DevServer {
        // SAFETY: `DirectoryWatchStore` is only ever the `directory_watchers`
        // field of a heap-allocated `DevServer` (never moved post-init).
        unsafe {
            bun_core::from_field_ptr!(
                DevServer,
                directory_watchers,
                std::ptr::from_mut::<Self>(self)
            )
        }
    }

    /// Safe sibling-projection: borrow the owning [`DevServer`]'s
    /// `bun_watcher` while holding `&mut self`. The two fields are disjoint,
    /// so the returned `&mut Watcher` does not alias `self`.
    #[inline]
    fn dev_bun_watcher(&mut self) -> &mut bun_watcher::Watcher {
        // SAFETY: `owner()` recovers the heap-allocated `DevServer`;
        // `bun_watcher` is field-disjoint from `directory_watchers`, so
        // `&mut self` and the returned borrow cover non-overlapping memory.
        unsafe { &mut (*self.owner()).bun_watcher }
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

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.freeEntry({}, {:?})",
            entry_index,
            entry.dir
        );

        self.dev_bun_watcher().remove_at_index(
            bun_watcher::WatchItemKind::File,
            entry.watch_index,
            0,
            &[],
        );

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
    impl Default for Entry {
        fn default() -> Self {
            Self {
                dir: bun_sys::Fd::INVALID,
                dir_fd_owned: false,
                first_dep: 0,
                watch_index: 0,
            }
        }
    }
    /// `DirectoryWatchStore.Dep` — one resolution-failure to retry on dir change.
    pub struct Dep {
        pub next: Option<u32>,
        /// The file used. BORROWED slice into `IncrementalGraph.bundled_files`
        /// key storage; compared by *pointer identity* (Zig:
        /// `dep.source_file_path.ptr == file_path.ptr`). The graph calls
        /// `removeDependenciesForFile` before freeing the key, so the slice
        /// outlives every read — `RawSlice` invariant.
        pub source_file_path: bun_ptr::RawSlice<u8>,
        /// The specifier that failed. Allocated memory.
        pub specifier: Box<[u8]>,
    }
    impl Default for Dep {
        fn default() -> Self {
            Dep {
                next: None,
                source_file_path: bun_ptr::RawSlice::EMPTY,
                specifier: Box::default(),
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK §Dispatch — DevServerVTable impl (high tier provides static)
// ══════════════════════════════════════════════════════════════════════════

bun_bundler::link_impl_DevServerHandle! {
    Bake for DevServer => |this| {
        barrel_needed_exports() => &raw mut (*this).barrel_needed_exports,
        log_for_resolution_failures(abs_path, graph) => {
            match (*this).get_log_for_resolution_failures(abs_path, graph) {
                Ok(log) => log,
                Err(_) => bun_alloc::out_of_memory(),
            }
        },
        finalize_bundle(bv2, result) => {
            // `bv2` borrows the three `Transpiler`s stored inline in `DevServer`
            // (stable heap address); the `'static` is a stand-in for the
            // DevServer-self lifetime — see `CurrentBundle.bv2` PORT NOTE.
            super::dev_server_body::finalize_bundle(&mut *this, &mut *bv2.cast(), &mut *result)
                .map_err(Into::into)
        },
        handle_parse_task_failure(err, graph, abs_path, log, bv2) => {
            (*this)
                .handle_parse_task_failure(err, graph, abs_path, &*log, &mut *bv2)
                .map_err(Into::into)
        },
        put_or_overwrite_asset(path, contents, content_hash) => {
            // `path` was erased from `&bun_resolver::fs::Path<'_>` at the
            // `DevServerHandle::put_or_overwrite_asset_erased` call site. Re-wrap
            // bytes as an owned blob (Zig spec transferred ownership).
            let path = &*path.cast::<bun_resolver::fs::Path<'_>>();
            let blob = crate::webcore::blob::Any::from_owned_slice(contents.to_vec());
            (*this).put_or_overwrite_asset(path, blob, content_hash)
        },
        track_resolution_failure(import_source, specifier, renderer, loader) => {
            (*this)
                .directory_watchers
                .track_resolution_failure(import_source, specifier, renderer, loader)
                .map_err(Into::into)
        },
        is_file_cached(abs_path, side) => {
            (*this).is_file_cached(abs_path, side).map(|e| {
                use bun_bundler::bake_types::CacheKind;
                bun_bundler::bake_types::CacheEntry {
                    kind: match e.kind {
                        FileKind::Unknown => CacheKind::Unknown,
                        FileKind::Js => CacheKind::Js,
                        FileKind::Asset => CacheKind::Asset,
                        FileKind::Css => CacheKind::Css,
                    },
                }
            })
        },
        asset_hash(abs_path) => (*this).assets.get_hash(abs_path),
        current_bundle_start_data() => {
            (*this)
                .current_bundle
                .as_mut()
                .map(|c| (&raw mut c.start_data).cast::<()>())
                .unwrap_or(core::ptr::null_mut())
        },
        register_barrel_with_deferrals(path) => {
            let _ = (*this)
                .barrel_files_with_deferrals
                .get_or_put(path)
                .map_err(|_| bun_alloc::out_of_memory());
            Ok(())
        },
        register_barrel_export(barrel_path, alias) => {
            // Zig `persistBarrelExport` (barrel_imports.zig:540) does
            // `getOrPut(...) catch return` — silently drop on alloc failure.
            let Ok(gop) = (*this).barrel_needed_exports.get_or_put(barrel_path) else {
                return;
            };
            let _ = gop.value_ptr.get_or_put(alias);
        },
    }
}

impl DevServer {
    /// Length of `configuration_hash_key` — Zig: `[16]u8`.
    pub const CONFIGURATION_HASH_KEY_LEN: usize = 16;

    /// Construct the erased handle the bundler stores in
    /// `Transpiler.options.dev_server` / `LinkerContext.dev_server`.
    #[inline]
    pub fn bundler_handle(&mut self) -> bun_bundler::dispatch::DevServerHandle {
        // SAFETY: `self` is the single per-process DevServer; outlives all dispatch.
        unsafe {
            bun_bundler::dispatch::DevServerHandle::new(
                bun_bundler::dispatch::DevServerHandleKind::Bake,
                self,
            )
        }
    }
}

/// `DirectoryWatchStore.insert` error set — DirectoryWatchStore.zig:101.
#[derive(thiserror::Error, Debug)]
enum DirectoryWatchInsertError {
    #[error("Ignore")]
    Ignore,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(DirectoryWatchInsertError);

impl DirectoryWatchStore {
    /// `DirectoryWatchStore.trackResolutionFailure` — DirectoryWatchStore.zig:28.
    pub fn track_resolution_failure(
        &mut self,
        import_source: &[u8],
        specifier: &[u8],
        renderer: Graph,
        loader: bun_ast::Loader,
    ) -> Result<(), bun_alloc::AllocError> {
        use bun_ast::Loader;
        // When it does not resolve to a file path, there is nothing to track.
        if specifier.is_empty() {
            return Ok(());
        }
        if !bun_paths::is_absolute(import_source) {
            return Ok(());
        }

        match loader {
            Loader::Tsx | Loader::Ts | Loader::Jsx | Loader::Js => {
                if !(specifier.starts_with(b"./") || specifier.starts_with(b"../")) {
                    return Ok(());
                }
            }
            // Imports in CSS can resolve to relative files without './'
            // Imports in HTML can resolve to project-relative paths by
            // prefixing with '/', but that is done in HTMLScanner.
            Loader::Css | Loader::Html => {}
            // Multiple parts of DevServer rely on the fact that these
            // loaders do not depend on importing other files.
            _ => debug_assert!(false),
        }

        let mut buf = bun_paths::path_buffer_pool::get();
        let joined = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
            bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(import_source),
            &mut buf.0,
            &[specifier],
        );
        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(joined);

        // The `import_source` parameter is not a stable string. Since the
        // import source will be added to IncrementalGraph anyways, this is a
        // great place to share memory.
        // SAFETY: owner() recovers `*mut DevServer`; `client_graph`/`server_graph`/
        // `graph_safety_lock` are disjoint from `directory_watchers` so this does
        // not alias `&mut self`.
        let dev = self.owner();
        // SAFETY: `dev` is the heap-allocated DevServer; `graph_safety_lock` is
        // disjoint from `directory_watchers`. RAII guard unlocks on drop.
        let _g = unsafe { (*dev).graph_safety_lock.guard() };
        let owned_file_path: bun_ptr::RawSlice<u8> = match renderer {
            Graph::Client => {
                unsafe { &mut (*dev).client_graph }
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
            Graph::Server | Graph::Ssr => {
                unsafe { &mut (*dev).server_graph }
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
        };

        match self.insert(dir, owned_file_path, specifier) {
            Ok(()) => Ok(()),
            Err(DirectoryWatchInsertError::Ignore) => Ok(()), // ignoring watch errors.
            Err(DirectoryWatchInsertError::OutOfMemory) => Err(bun_alloc::AllocError),
        }
    }

    /// `DirectoryWatchStore.insert` — DirectoryWatchStore.zig:101.
    /// `dir_name_to_watch` is cloned; `file_path` must outlive the watch;
    /// `specifier` is cloned.
    fn insert(
        &mut self,
        dir_name_to_watch: &[u8],
        file_path: bun_ptr::RawSlice<u8>,
        specifier: &[u8],
    ) -> Result<(), DirectoryWatchInsertError> {
        debug_assert!(!specifier.is_empty());
        // TODO: watch the parent dir too.
        // PORT NOTE: take a raw pointer so the &mut self borrow from owner() does
        // not overlap subsequent self.* field accesses (Zig has no borrowck here).
        let dev: *mut DevServer = self.owner();

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.insert({}, {}, {})",
            bun_core::fmt::quote(dir_name_to_watch),
            bun_core::fmt::quote(file_path.slice()),
            bun_core::fmt::quote(specifier),
        );

        if self.dependencies_free_list.is_empty() {
            // PERF(port): was ensureUnusedCapacity — profile in Phase B
            self.dependencies.reserve(1);
        }

        // PORT NOTE: reshaped for borrowck — capture gop scalars before
        // calling self methods that need &mut self.
        let gop = self.watches.get_or_put(
            bun_paths::string_paths::without_trailing_slash_windows_path(dir_name_to_watch),
        )?;
        let gop_index = gop.index;
        let found_existing = gop.found_existing;

        let specifier_cloned: Box<[u8]> =
            if specifier[0] == b'.' || bun_paths::is_absolute(specifier) {
                Box::<[u8]>::from(specifier)
            } else {
                let mut v = Vec::with_capacity(2 + specifier.len());
                v.extend_from_slice(b"./");
                v.extend_from_slice(specifier);
                v.into_boxed_slice()
            };
        // errdefer free(specifier_cloned) — handled by Drop on `?` paths.

        if found_existing {
            let prev_first = Some(self.watches.values()[gop_index].first_dep);
            let dep = self.append_dep_assume_capacity(directory_watch_store::Dep {
                next: prev_first,
                source_file_path: file_path,
                specifier: specifier_cloned,
            });
            self.watches.values_mut()[gop_index].first_dep = dep;
            return Ok(());
        }

        // PORT NOTE: `errdefer store.watches.swapRemoveAt(gop.index)` — guard the
        // map via raw ptr so it doesn't conflict with `&mut self` below.
        let watches_ptr: *mut StringArrayHashMap<directory_watch_store::Entry> =
            &raw mut self.watches;
        let watches_guard = scopeguard::guard(gop_index, move |idx| {
            // SAFETY: `watches_ptr` points into the heap-allocated DevServer; on
            // the error path no other borrow of `self.watches` is outstanding.
            let _ = unsafe { (*watches_ptr).swap_remove_at(idx) };
        });

        // Try to use an existing open directory handle
        // SAFETY: server_transpiler is initialized by Framework::init_transpiler
        // before DevServer accepts requests; `dev` is a valid *mut DevServer.
        let cache_fd: Option<bun_sys::Fd> =
            match unsafe { (*dev).server_transpiler.assume_init_mut() }
                .resolver
                .read_dir_info(dir_name_to_watch)
            {
                Ok(Some(cache)) => {
                    let fd = cache.get_file_descriptor();
                    if fd.is_valid() { Some(fd) } else { None }
                }
                Ok(None) | Err(_) => None,
            };

        let (fd, owned_fd): (bun_sys::Fd, bool) = if bun_watcher::REQUIRES_FILE_DESCRIPTORS {
            if let Some(fd) = cache_fd {
                (fd, false)
            } else {
                // std.posix.toPosixPath — build a NUL-terminated path buffer.
                if dir_name_to_watch.len() >= bun_paths::MAX_PATH_BYTES {
                    return Err(DirectoryWatchInsertError::Ignore); // NameTooLong
                }
                let mut zbuf = bun_paths::path_buffer_pool::get();
                let zpath = bun_paths::resolve_path::z(dir_name_to_watch, &mut *zbuf);
                match bun_sys::open(
                    zpath,
                    bun_sys::O::DIRECTORY | bun_watcher::WATCH_OPEN_FLAGS,
                    0,
                ) {
                    Ok(fd) => (fd, true),
                    Err(err) => match err.get_errno() {
                        // If this directory doesn't exist, a watcher should be placed
                        // on the parent directory. Then, if this directory is later
                        // created, the watcher can be properly initialized.
                        bun_sys::E::ENOENT => {
                            // TODO: implement that. for now it ignores (BUN-10968)
                            return Err(DirectoryWatchInsertError::Ignore);
                        }
                        bun_sys::E::ENOTDIR => return Err(DirectoryWatchInsertError::Ignore),
                        _ => bun_core::todo_panic!("log watcher error"),
                    },
                }
            }
        } else {
            (bun_sys::Fd::INVALID, false)
        };
        let fd_guard = scopeguard::guard(fd, move |fd| {
            if bun_watcher::REQUIRES_FILE_DESCRIPTORS && owned_fd {
                fd.close();
            }
        });

        let dir_name: Box<[u8]> = Box::<[u8]>::from(dir_name_to_watch);
        // errdefer free(dir_name) — handled by Drop.

        // PORT NOTE: Zig sets `key_ptr` to a sub-slice of `dir_name` (trailing
        // slash trimmed) sharing its allocation. `StringArrayHashMap` already
        // boxed the trimmed key on insert above, so the reassignment is a
        // no-op here; `dir_name` is kept solely for `add_directory`/`get_hash`.

        let watch_index = match self.dev_bun_watcher().add_directory::<false>(
            fd,
            &dir_name,
            bun_watcher::Watcher::get_hash(&dir_name),
        ) {
            Err(_) => return Err(DirectoryWatchInsertError::Ignore),
            Ok(id) => id,
        };

        // Disarm errdefer guards: success path.
        let fd = scopeguard::ScopeGuard::into_inner(fd_guard);
        let _ = scopeguard::ScopeGuard::into_inner(watches_guard);

        let dep = self.append_dep_assume_capacity(directory_watch_store::Dep {
            next: None,
            source_file_path: file_path,
            specifier: specifier_cloned,
        });
        self.watches.values_mut()[gop_index] = directory_watch_store::Entry {
            dir: fd,
            dir_fd_owned: owned_fd,
            first_dep: dep,
            watch_index,
        };
        let _ = dir_name; // keep alive past add_directory; dropped here
        Ok(())
    }

    /// Appends a dependency into the first free slot, returning its index.
    /// Capacity for one element must already be ensured.
    fn append_dep_assume_capacity(&mut self, dep: directory_watch_store::Dep) -> u32 {
        if let Some(index) = self.dependencies_free_list.pop() {
            self.dependencies[index as usize] = dep;
            index
        } else {
            let index = u32::try_from(self.dependencies.len()).expect("int cast");
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            self.dependencies.push(dep);
            index
        }
    }

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
                let dep_path = self.dependencies[index as usize].source_file_path;
                it = dep_next;
                // Pointer-identity comparison (Zig: `dep.source_file_path.ptr == file_path.ptr`).
                if dep_path.slice().as_ptr() == file_path.as_ptr() {
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
