//! Instance of the development server. Attaches to an instance of `Bun.serve`,
//! controlling bundler, routing, and hot module reloading.
//!
//! Request handling, hot-update tracing, and `finalize_bundle` live in
//! `../DevServer.rs` (`dev_server_body`). This file holds:
//!   - the `DevServer` struct definition
//!   - leaf enums/newtypes (`FileKind`, `ChunkKind`, `Magic`, `MessageId`, …)
//!   - submodule struct types (`Assets`, `RouteBundle`, `SourceMapStore`, …)
//!   - `bun_bundler::dispatch::DevServerVTable` wiring (`DEV_SERVER_VTABLE`)
//!   - `is_file_cached`

#![allow(clippy::module_inception)]

use core::cell::Cell;
use core::sync::atomic::Ordering;

use bun_collections::{HashMap, StringArrayHashMap, bit_set::DynamicBitSet};
use bun_ptr::JsCell;
use bun_sys::FdExt as _;

use super::jsc;
use super::{Graph, Side};

// ─── submodules ──────────────────────────────────────────────────────────────
pub(crate) mod error_report_request;
pub(crate) mod hmr_socket;
mod js_escape;
pub(crate) mod memory_cost;

// NOTE: the `DevServer` scoped-log static (`ScopedLogger`) is declared in
// `dev_server_body` (`bun_output::declare_scope!(DevServer, visible)`) and
// re-exported via the `pub use` block below alongside the `struct DevServer`
// type. Declaring it again here would collide in the value namespace.

pub(crate) const ASSET_PREFIX: &str = "/_bun/asset";
pub(crate) const CLIENT_PREFIX: &str = "/_bun/client";

// LAYERING: the 4.8 kL of method bodies live in `../DevServer.rs` (mounted as
// `super::dev_server_body`). The struct definitions are owned there so impl
// blocks and submodules name a single type. Re-export so
// `crate::bake::dev_server::DevServer` (the public path used by `server/`,
// `dispatch.rs`, …) resolves to that one struct.
pub(crate) use super::dev_server_body::BundleRequest;
pub use super::dev_server_body::{
    CacheEntry, CurrentBundle, DeferredPromise, DeferredRequest, DevServer, DevServerCell,
    EntryPointList, HTMLRouter, Magic, NextBundle, Options, PluginState, RouteIndexAndRecurseFlag,
    TestingBatch, TestingBatchEvents, deferred_request, entry_point_list,
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
/// Discriminants MUST NOT change: `kind as u8` is sent across FFI to
/// `InspectorBunFrontendDevServerAgent__notifyConsoleLog`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ConsoleLogKind {
    Log = b'l',
    Err = b'e',
}

/// `DevServer.MessageId` — first byte of every server→client HMR frame.
/// Discriminants are the HMR wire protocol and MUST match the client
/// (`generated.ts`).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum MessageId {
    Version = b'V',
    HotUpdate = b'u',
    Errors = b'e',
    Visualizer = b'v',
    MemoryVisualizer = b'M',
    SetUrlResponse = b'n',
    TestingWatchSynchronization = b'r',
}
impl MessageId {
    #[inline]
    pub(crate) fn char(self) -> u8 {
        self as u8
    }
}

/// `DevServer.IncomingMessageId` — first byte of every client→server HMR frame.
/// Discriminants are the HMR wire protocol and MUST match the client
/// (`generated.ts`).
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

/// `DevServer.HmrTopic`. Discriminants are the HMR wire protocol and MUST
/// match the client.
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
    pub(crate) const MAX_COUNT: usize = 6;

    /// All variants in declaration order.
    pub(crate) const ALL: &[HmrTopic] = &[
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
    pub(crate) fn from_u8(ch: u8) -> Option<HmrTopic> {
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

    /// uWS topic name for this HMR channel. The leading `0xFF` byte cannot
    /// occur in WTF-8, so no topic string passed to `ServerWebSocket`
    /// `subscribe()`/`publish()` or `Server.publish()` can ever name it.
    #[inline]
    pub(crate) fn uws_topic(self) -> [u8; 2] {
        [0xFF, self as u8]
    }

    /// Maps a topic to its packed `HmrTopicBits` flag.
    #[inline]
    pub(crate) fn as_bit(self) -> crate::bake::dev_server_body::HmrTopicBits {
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
    pub(crate) client_bits: DynamicBitSet,
    pub(crate) server_bits: DynamicBitSet,
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
    }
}

pub(crate) use super::dev_server_body::init;

pub mod assets;
pub mod incremental_graph;
pub mod inspector_agent;
pub mod packed_map;
pub mod route_bundle;
pub mod serialized_failure;
pub mod source_map_store;

pub use serialized_failure::SerializedFailure;

/// Local response trait — the response type is a generic bound.
/// Method shapes mirror `bun_uws_sys::Response<SSL>` so the `R`-generic
/// bodies type-check. `bun_uws` exposes no equivalent trait; if it ever
/// grows one, this can be replaced by it.
pub trait ResponseLike {
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
/// message handlers) live in [`hmr_socket`]. Heap-allocated and ref-counted:
/// one ref is held by the uws socket's user-data slot (moved in by
/// `upgrade_ref`, released after `on_close`) and one by
/// `dev.active_websocket_connections` until `on_close` removes it.
#[derive(bun_ptr::CellRefCounted)]
pub struct HmrSocket {
    ref_count: Cell<u32>,
    /// The owning dev server's cell (it closes every socket before it is
    /// freed); `None` once it has detached this socket.
    pub(crate) dev: Cell<Option<bun_ptr::BackRef<DevServerCell>>>,
    pub(crate) underlying: Cell<Option<bun_uws::AnyWebSocket>>,
    pub(crate) subscriptions: Cell<super::dev_server_body::HmrTopicBits>,
    /// By telling DevServer the active route, this enables receiving detailed
    /// `hot_update` events for when the route is updated.
    pub(crate) active_route: Cell<route_bundle::IndexOptional>,
    /// Source-map keys this socket has been sent; used to ref-count entries
    /// in `SourceMapStore` so they survive until the socket disconnects.
    pub(crate) referenced_source_maps: JsCell<HashMap<source_map_store::Key, ()>>,
    pub(crate) inspector_connection_id: Cell<i32>,
}

impl HmrSocket {
    /// `subscriptions` is a packed `HmrTopicBits` value; test the bit for a
    /// given topic.
    #[inline]
    pub(crate) fn is_subscribed(&self, topic: HmrTopic) -> bool {
        self.subscriptions.get().contains(topic.as_bit())
    }
}

/// The file lists of one `DevServer.HotReloadEvent`, filled by the watcher
/// thread and drained on the JS thread (see [`HotReloadShared`]).
pub struct HotReloadFiles {
    pub(crate) files: StringArrayHashMap<()>,
    pub(crate) dirs: StringArrayHashMap<()>,
    /// NUL-joined absolute paths.
    pub(crate) extra_files: Vec<u8>,
    pub(crate) timer: std::time::Instant,
}

/// `DevServer.HotReloadEvent` — one slot of [`HotReloadShared::events`]. The
/// triple-buffer protocol on `HotReloadShared::next_event` hands a slot to one
/// thread at a time; the mutex makes that exclusive access a type-level fact.
// Cache-line aligned so the watcher and JS thread slots do not false-share.
#[repr(align(128))]
pub struct HotReloadEvent {
    pub(crate) data: bun_threading::Guarded<HotReloadFiles>,
}

impl HotReloadEvent {
    fn new() -> HotReloadEvent {
        HotReloadEvent {
            data: bun_threading::Guarded::new(HotReloadFiles::default()),
        }
    }
}

impl Default for HotReloadFiles {
    fn default() -> Self {
        HotReloadFiles {
            files: Default::default(),
            dirs: Default::default(),
            extra_files: Vec::new(),
            timer: std::time::Instant::now(),
        }
    }
}

impl HotReloadFiles {
    pub(crate) fn is_empty(&self) -> bool {
        (self.files.count() + self.dirs.count()) == 0
    }

    /// Invalidates items in IncrementalGraph, appending all new items to `entry_points`.
    pub(crate) fn process_file_list(
        &mut self,
        dev: &mut DevServer,
        entry_points: &mut EntryPointList,
    ) {
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
                let _ = dev.server_transpiler.resolver.bust_dir_cache(changed_dir);

                // if a directory watch exists for resolution failures, check those now.
                if let Some(watcher_index) = dev.directory_watchers.watches.get_index(changed_dir) {
                    let mut new_chain: Option<u32> = None;
                    let mut it: Option<u32> =
                        Some(dev.directory_watchers.watches.values()[watcher_index].first_dep);

                    while let Some(index) = it {
                        let resolved = {
                            let dep = &dev.directory_watchers.dependencies[index as usize];
                            it = dep.next;
                            dev.server_transpiler
                                .resolver
                                .resolve(
                                    bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                        dep.source_file_path.slice(),
                                    ),
                                    &dep.specifier,
                                    bun_ast::ImportKind::Stmt,
                                )
                                .is_ok()
                        };

                        if resolved {
                            // this resolution result is not preserved as passing it
                            // into BundleV2 is too complicated. the resolution is
                            // cached, anyways.
                            bun_core::handle_oom(
                                self.files.get_or_put(
                                    dev.directory_watchers.dependencies[index as usize]
                                        .source_file_path
                                        .slice(),
                                ),
                            );
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
                        let (store, watcher) = dev.directory_watchers_and_watcher();
                        store.free_entry(watcher, watcher_index);
                    }
                }
            }
        }

        let mut rest_extra: &[u8] = &self.extra_files;
        while let Some(str_idx) = bun_core::strings::index_of_char_usize(rest_extra, 0) {
            bun_core::handle_oom(self.files.put(&rest_extra[0..str_idx as usize], ()));
            rest_extra = &rest_extra[str_idx as usize + 1..];
        }
        if !rest_extra.is_empty() {
            bun_core::handle_oom(self.files.put(rest_extra, ()));
        }

        let changed_file_paths = self.files.keys();
        bun_core::handle_oom(
            dev.server_graph
                .invalidate(changed_file_paths, entry_points),
        );
        bun_core::handle_oom(
            dev.client_graph
                .invalidate(changed_file_paths, entry_points),
        );

        if entry_points.set.count() == 0 {
            bun_core::debug_warn!("nothing to bundle");
            if !changed_file_paths.is_empty() {
                bun_core::debug_warn!(
                    "modified files: {}",
                    bun_core::fmt::fmt_slice(changed_file_paths, ", ")
                );
            }
            if self.dirs.count() > 0 {
                bun_core::debug_warn!(
                    "modified dirs: {}",
                    bun_core::fmt::fmt_slice(self.dirs.keys(), ", ")
                );
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
        self.files.clear_retaining_capacity();
        self.dirs.clear_retaining_capacity();
        self.extra_files.clear();
    }

    /// Records a changed file path in the pending hot-reload event (deduplicated).
    pub(crate) fn append_file(&mut self, file_path: &[u8]) {
        bun_core::handle_oom(self.files.get_or_put(file_path));
    }

    /// Records a changed directory (and, when present, the changed entry
    /// within it) in the pending hot-reload event (deduplicated).
    pub(crate) fn append_dir(&mut self, dir_path: &[u8], maybe_sub_path: Option<&[u8]>) {
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
        self.extra_files.extend_from_slice(if ends_with_sep {
            &dir_path[0..dir_path.len() - 1]
        } else {
            dir_path
        });
        self.extra_files.push(bun_paths::SEP);
        self.extra_files.extend_from_slice(sub_path);
        self.extra_files.push(0);
    }
}

/// A hot-reload event posted to the JS thread by the watcher thread
/// ([`HotReloadShared::watcher_release_and_submit_event`]). Dispatched under
/// `task_tag::BakeHotReloadEvent`.
pub struct HotReloadTask {
    pub(crate) shared: std::sync::Arc<HotReloadShared>,
    pub(crate) first: u8,
}

impl HotReloadTask {
    /// Main-thread side of the watcher → DevServer hand-off.
    pub(crate) fn run(self) {
        let Some(dev) = self.shared.main.lock().dev.clone() else {
            // The DevServer was dropped while this task was queued.
            return;
        };
        let first = self.first;
        let cell = dev.get();
        if let Some(bundle) = cell.with_mut(|dev| dev.on_hot_reload_task(&self.shared, first)) {
            let _ = DevServer::start_async_bundle(cell, bundle);
        }
    }

    /// The task was still queued when its VM shut down; nothing to release
    /// beyond the task itself.
    pub(crate) fn release_unrun(self) {}
}

impl DevServer {
    /// Returns the bundle to start for this event, if any.
    fn on_hot_reload_task(&mut self, shared: &HotReloadShared, first: u8) -> Option<BundleRequest> {
        debug_assert!(self.magic == Magic::Valid);
        bun_core::scoped_log!(DevServer, "HMR Task start");
        scopeguard::defer! {
            bun_core::scoped_log!(DevServer, "HMR Task end");
        }

        if self.current_bundle.is_some() {
            self.next_bundle.reload_event = Some(first);
            return None;
        }

        let mut entry_points = EntryPointList::default();
        let timer = self.drain_hot_reload_events(shared, first, &mut entry_points);

        if entry_points.set.count() == 0 {
            return None;
        }

        match &mut self.testing_batch_events {
            TestingBatchEvents::Disabled => {}
            TestingBatchEvents::Enabled(ev) => {
                bun_core::handle_oom(ev.append(&entry_points));
                self.publish(
                    HmrTopic::TestingWatchSynchronization,
                    &[MessageId::TestingWatchSynchronization.char(), 1],
                    bun_uws::Opcode::BINARY,
                );
                return None;
            }
            TestingBatchEvents::EnableAfterBundle => debug_assert!(false),
        }

        Some(BundleRequest {
            entry_points,
            had_reload_event: true,
            timer,
        })
    }

    /// Process the event in slot `first` and every event the watcher queued
    /// behind it, appending to `entry_points`. Returns the first event's timer.
    pub(crate) fn drain_hot_reload_events(
        &mut self,
        shared: &HotReloadShared,
        first: u8,
        entry_points: &mut EntryPointList,
    ) -> std::time::Instant {
        let mut current = first;
        let mut timer = None;
        loop {
            // Taken out so the slot's lock is not held across graph work
            // (which may take `Watcher.mutex`; the watcher thread takes the
            // two in the other order).
            let mut files = ::core::mem::take(&mut *shared.events[current as usize].data.lock());
            files.process_file_list(self, entry_points);
            timer.get_or_insert(files.timer);
            *shared.events[current as usize].data.lock() = files;
            match shared.recycle_event_from_dev_server(current) {
                Some(next) => current = next,
                None => break,
            }
        }
        timer.expect("at least one event")
    }
}

/// State touched only by the watcher thread (under `Watcher.mutex`).
struct WatcherSide {
    /// Index into `events` currently being processed by the JS thread.
    current_event: Option<u8>,
    /// Index into `events` queued behind `current_event`.
    pending_event: Option<u8>,
    #[cfg(debug_assertions)]
    dbg_acquired_event: Option<u8>,
}

/// State touched only by the JS thread.
pub(crate) struct MainSide {
    /// Cleared by `Drop for DevServer`; a queued [`HotReloadTask`] that finds
    /// `None` does nothing.
    pub(crate) dev: Option<bun_ptr::ThreadBound<DevServerCell>>,
    #[cfg(debug_assertions)]
    dbg_server_event: Option<u8>,
}

/// `DevServer.WatcherAtomics` — three pre-allocated `HotReloadEvent`s rotated
/// between the watcher thread and the JS thread. Shared (`Arc`) by the
/// `DevServer`, its watcher's [`DevWatcherHandler`], and any queued
/// [`HotReloadTask`].
pub struct HotReloadShared {
    pub(crate) events: [HotReloadEvent; 3],
    /// Atomically encodes a `NextEvent`: values 0..3 are an index into
    /// `events`, plus the `WAITING`/`DONE` sentinels.
    pub(crate) next_event: core::sync::atomic::AtomicU8,
    watcher: bun_threading::Guarded<WatcherSide>,
    pub(crate) main: bun_threading::Guarded<MainSide>,
    vm_handle: bun_jsc::VmHandle,
}

/// Stored in `HotReloadShared::next_event` (an `AtomicU8`). Modeled as a
/// transparent newtype rather than a `#[repr(u8)] enum` because any value
/// other than the named constants is an index into the `events` array, and
/// Rust enums cannot hold unlisted discriminants.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct NextEvent(pub(crate) u8);

impl NextEvent {
    /// An event is running, and no next event is pending.
    pub(crate) const WAITING: NextEvent = NextEvent(u8::MAX - 1);
    /// No event is running.
    pub(crate) const DONE: NextEvent = NextEvent(u8::MAX);
    // Any other value represents an index into the `events` array.
}

impl HotReloadShared {
    pub(crate) fn new(
        dev: Option<bun_ptr::ThreadBound<DevServerCell>>,
        vm_handle: bun_jsc::VmHandle,
    ) -> std::sync::Arc<Self> {
        std::sync::Arc::new(HotReloadShared {
            events: [
                HotReloadEvent::new(),
                HotReloadEvent::new(),
                HotReloadEvent::new(),
            ],
            next_event: core::sync::atomic::AtomicU8::new(NextEvent::DONE.0),
            watcher: bun_threading::Guarded::new(WatcherSide {
                current_event: None,
                pending_event: None,
                #[cfg(debug_assertions)]
                dbg_acquired_event: None,
            }),
            main: bun_threading::Guarded::new(MainSide {
                dev,
                #[cfg(debug_assertions)]
                dbg_server_event: None,
            }),
            vm_handle,
        })
    }

    /// Called by DevServer after it receives a task callback. If this returns
    /// another event, that event should be passed again to this function, and
    /// so on, until this function returns `None`.
    ///
    /// Runs on dev server thread.
    pub(crate) fn recycle_event_from_dev_server(&self, old_event: u8) -> Option<u8> {
        self.events[old_event as usize].data.lock().reset();

        #[cfg(debug_assertions)]
        {
            let dbg_event = self.main.lock().dbg_server_event.take();
            debug_assert!(
                dbg_event == Some(old_event),
                "recycleEventFromDevServer: old_event: expected {dbg_event:?}, got {old_event}",
            );
        }

        let event = loop {
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
                _ => break next.0,
            }
        };

        #[cfg(debug_assertions)]
        {
            self.main.lock().dbg_server_event = Some(event);
        }
        Some(event)
    }

    /// Pick the slot in `events` that the JS thread is not using. Call
    /// `watcher_release_and_submit_event` when it is filled with files.
    ///
    /// Called from watcher thread.
    pub(crate) fn watcher_acquire_event(&self) -> u8 {
        #[cfg_attr(not(debug_assertions), allow(unused_mut))] // written only by the debug slot check
        let mut w = self.watcher.lock();
        let mut available = [true; 3];
        if let Some(i) = w.current_event {
            available[i as usize] = false;
        }
        if let Some(i) = w.pending_event {
            available[i as usize] = false;
        }
        let index = available
            .iter()
            .position(|&free| free)
            .expect("one of three slots is always free") as u8;

        #[cfg(debug_assertions)]
        {
            debug_assert!(
                w.dbg_acquired_event.is_none(),
                "must call `watcher_release_and_submit_event` before calling `watcher_acquire_event` again",
            );
            w.dbg_acquired_event = Some(index);
        }
        drop(w);

        let mut files = self.events[index as usize].data.lock();
        // Initialize the timer if it is empty.
        if files.is_empty() {
            files.timer = std::time::Instant::now();
        }
        index
    }

    /// Release the slot from `watcher_acquire_event`, submitting the event to
    /// the JS thread if it contains new files.
    ///
    /// Called from watcher thread.
    pub(crate) fn watcher_release_and_submit_event(self: &std::sync::Arc<Self>, ev: u8) {
        let mut w = self.watcher.lock();
        #[cfg(debug_assertions)]
        {
            let dbg_event = w.dbg_acquired_event.take().expect(
                "must call `watcher_acquire_event` before `watcher_release_and_submit_event`",
            );
            debug_assert!(
                dbg_event == ev,
                "watcher_release_and_submit_event: event is not from last `watcher_acquire_event` call (expected {dbg_event}, got {ev})",
            );
        }

        if self.events[ev as usize].data.lock().is_empty() {
            return;
        }
        // There are files to be processed.

        let old_next = NextEvent(self.next_event.swap(ev, Ordering::AcqRel));
        match old_next {
            NextEvent::DONE => {
                // Dev server is done running events. We need to schedule the event directly.
                w.current_event = Some(ev);
                w.pending_event = None;
                // Relaxed because the dev server is not running events right now.
                // (could technically be made non-atomic)
                self.next_event
                    .store(NextEvent::WAITING.0, Ordering::Relaxed);
                #[cfg(debug_assertions)]
                {
                    let mut main = self.main.lock();
                    debug_assert!(
                        main.dbg_server_event.is_none(),
                        "no event should be running right now",
                    );
                    main.dbg_server_event = Some(ev);
                }
                // Refused ⇒ the VM is torn down; the event simply never runs.
                let _ = self.vm_handle.post_boxed(
                    bun_jsc::LoopKind::Regular,
                    Box::new(HotReloadTask {
                        shared: std::sync::Arc::clone(self),
                        first: ev,
                    }),
                );
            }

            NextEvent::WAITING => {
                if w.pending_event.is_some() {
                    // `pending_event` is running, which means we're done with `current_event`.
                    w.current_event = w.pending_event;
                } // else, no pending event yet, but not done with `current_event`.
                w.pending_event = Some(ev);
            }

            _ => {
                // This is an index into the `events` array.
                let old_index: u8 = old_next.0;
                debug_assert!(
                    w.pending_event == Some(old_index),
                    "watcher_release_and_submit_event: expected `pending_event` to be {}; got {:?}",
                    old_index,
                    w.pending_event,
                );
                // The old pending event hadn't been run yet, so we can replace it with `ev`.
                w.pending_event = Some(ev);
            }
        }
    }
}

/// The watcher-thread half of a `DevServer`: receives file-change batches
/// from its [`bun_watcher::Watcher`] and forwards them to the JS thread through
/// [`HotReloadShared`].
pub struct DevWatcherHandler {
    pub(crate) shared: std::sync::Arc<HotReloadShared>,
}

/// `DevServer.DirectoryWatchStore` — sparse map of directories under watch
/// for resolution-failure recovery.
///
/// When a file fails to import a relative path, directory watchers are added
/// so that when a matching file is created, the dependencies can be rebuilt.
/// This handles HMR cases where a user writes an import before creating the
/// file, or moves files around. Not thread-safe.
///
/// Known gap: when the importing file fixes its resolution (the failing
/// import is removed or renamed), nothing walks this store to release the
/// now-unneeded watcher; it stays until the directory changes or the file
/// is evicted from the incremental graph.
#[derive(Default)]
pub struct DirectoryWatchStore {
    pub(crate) watches: StringArrayHashMap<directory_watch_store::Entry>,
    pub(crate) dependencies: Vec<directory_watch_store::Dep>,
    /// Dependencies cannot be re-ordered. This list tracks what indexes are free.
    pub(crate) dependencies_free_list: Vec<u32>,
}

impl DirectoryWatchStore {
    /// Returns a dependency slot to the free list so it can be reused.
    pub(crate) fn free_dependency_index(&mut self, index: u32) {
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

    /// Expects dependency list to be already freed.
    pub(crate) fn free_entry(&mut self, watcher: &mut bun_watcher::Watcher, entry_index: usize) {
        let entry = self.watches.values()[entry_index];

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.freeEntry({}, {:?})",
            entry_index,
            entry.dir
        );

        watcher.remove_at_index::<true>(
            bun_watcher::WatchItemKind::File,
            entry.watch_index,
            0,
            &[],
        );

        // The Box key drops on swap_remove_at.
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
        pub(crate) dir: bun_sys::Fd,
        pub(crate) dir_fd_owned: bool,
        /// `Dep.Index` — head of the singly-linked dep chain for this dir.
        pub(crate) first_dep: u32,
        /// To pass to `Watcher.remove`.
        pub(crate) watch_index: u16,
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
        pub(crate) next: Option<u32>,
        /// The file used. BORROWED slice into `IncrementalGraph.bundled_files`
        /// key storage; compared by *pointer identity*. The graph calls
        /// `removeDependenciesForFile` before freeing the key, so the slice
        /// outlives every read — `RawSlice` invariant.
        pub(crate) source_file_path: bun_ptr::RawSlice<u8>,
        /// The specifier that failed. Allocated memory.
        pub(crate) specifier: Box<[u8]>,
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
    Bake for DevServerCell => |this| {
        barrel_needed_exports() => (*this).with_mut(|dev| &raw mut dev.barrel_needed_exports),
        log_for_resolution_failures(abs_path, graph) => (*this).with_mut(|dev| {
            match dev.get_log_for_resolution_failures(abs_path, graph) {
                Ok(log) => std::ptr::from_mut(log),
                Err(_) => bun_alloc::out_of_memory(),
            }
        }),
        finalize_bundle(bv2, result) => {
            // `bv2` borrows the three `Transpiler`s owned by `DevServer`; the
            // `'static` is a stand-in for the DevServer-self lifetime — see
            // the comment on `CurrentBundle.bv2`.
            let (bv2, result) = (&mut *bv2.cast(), &mut *result);
            super::dev_server_body::finalize_bundle(&*this, bv2, result)
                .map_err(|e| bun_bundler::Error::from(crate::Error::from(e)))
        },
        handle_parse_task_failure(err, graph, abs_path, log, bv2) => {
            let (log, bv2) = (&*log, &mut *bv2);
            (*this)
                .with_mut(|dev| {
                    dev.handle_parse_task_failure(&err.into(), graph, abs_path, log, bv2)
                })
                .map_err(Into::into)
        },
        put_or_overwrite_asset(path, contents, content_hash) => {
            // `path` was erased from `&bun_resolver::fs::Path<'_>` at the
            // `DevServerHandle::put_or_overwrite_asset_erased` call site. Re-wrap
            // bytes as an owned blob (ownership is transferred).
            let path = &*path.cast::<bun_resolver::fs::Path<'_>>();
            let blob = crate::webcore::blob::Any::from_owned_slice(contents.to_vec());
            (*this)
                .with_mut(|dev| dev.put_or_overwrite_asset(path, blob, content_hash))
                .map_err(Into::into)
        },
        track_resolution_failure(import_source, specifier, renderer, loader) => {
            (*this)
                .with_mut(|dev| {
                    dev.track_resolution_failure(import_source, specifier, renderer, loader)
                })
                .map_err(Into::into)
        },
        is_file_cached(abs_path, side) => {
            (*this).with_mut(|dev| dev.is_file_cached(abs_path, side)).map(|e| {
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
        asset_hash(abs_path) => (*this).get().assets.get_hash(abs_path),
        current_bundle_start_data() => (*this).with_mut(|dev| {
            dev.current_bundle
                .as_mut()
                .map(|c| (&raw mut c.start_data).cast::<()>())
                .unwrap_or(core::ptr::null_mut())
        }),
        register_barrel_with_deferrals(path) => {
            (*this).with_mut(|dev| {
                let _ = dev
                    .barrel_files_with_deferrals
                    .get_or_put(path)
                    .map_err(|_| bun_alloc::out_of_memory());
            });
            Ok(())
        },
        register_barrel_export(barrel_path, alias) => (*this).with_mut(|dev| {
            // Silently drop on alloc failure.
            let Ok(gop) = dev.barrel_needed_exports.get_or_put(barrel_path) else {
                return;
            };
            let _ = gop.value_ptr.get_or_put(alias);
        }),
    }
}

impl DevServer {
    /// Length of `configuration_hash_key`.
    pub(crate) const CONFIGURATION_HASH_KEY_LEN: usize = 16;

    /// Construct the erased handle the bundler stores in
    /// `Transpiler.options.dev_server` / `LinkerContext.dev_server`.
    #[inline]
    pub(crate) fn bundler_handle(&self) -> bun_bundler::dispatch::DevServerHandle {
        // Held by `CurrentBundle.bv2`, which this dev server (the cell's
        // contents) owns and drops first.
        bun_bundler::dispatch::DevServerHandle::from_owner(self.this.expect("set by init()"))
    }
}

/// `DirectoryWatchStore::insert` error set.
#[derive(thiserror::Error, Debug)]
enum DirectoryWatchInsertError {
    #[error("Ignore")]
    Ignore,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(DirectoryWatchInsertError);

impl DevServer {
    /// Registers a directory watch so that a failed import resolution is
    /// retried when the containing directory changes.
    pub(crate) fn track_resolution_failure(
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
        let _g = self.graph_safety_lock.guard();
        let owned_file_path: bun_ptr::RawSlice<u8> = match renderer {
            Graph::Client => {
                self.client_graph
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
            Graph::Server | Graph::Ssr => {
                self.server_graph
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
        };

        let watcher = self.bun_watcher.as_deref_mut().expect("watcher is live");
        match self.directory_watchers.insert(
            watcher,
            &mut self.server_transpiler.resolver,
            dir,
            owned_file_path,
            specifier,
        ) {
            Ok(()) => Ok(()),
            Err(DirectoryWatchInsertError::Ignore) => Ok(()), // ignoring watch errors.
            Err(DirectoryWatchInsertError::OutOfMemory) => Err(bun_alloc::AllocError),
        }
    }
}

impl DirectoryWatchStore {
    /// `dir_name_to_watch` is cloned; `file_path` must outlive the watch;
    /// `specifier` is cloned.
    fn insert(
        &mut self,
        watcher: &mut bun_watcher::Watcher,
        resolver: &mut bun_resolver::Resolver,
        dir_name_to_watch: &[u8],
        file_path: bun_ptr::RawSlice<u8>,
        specifier: &[u8],
    ) -> Result<(), DirectoryWatchInsertError> {
        debug_assert!(!specifier.is_empty());
        // TODO: watch the parent dir too.

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.insert({}, {}, {})",
            bun_core::fmt::quote(dir_name_to_watch),
            bun_core::fmt::quote(file_path.slice()),
            bun_core::fmt::quote(specifier),
        );

        if self.dependencies_free_list.is_empty() {
            self.dependencies.reserve(1);
        }

        // Note: reshaped for borrowck — capture gop scalars before
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

        // errdefer store.watches.swapRemoveAt(gop.index)
        let watches_guard = scopeguard::guard(&mut self.watches, |watches| {
            let _ = watches.swap_remove_at(gop_index);
        });

        // Try to use an existing open directory handle
        let cache_fd: Option<bun_sys::Fd> = match resolver.read_dir_info(dir_name_to_watch) {
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
                // Build a NUL-terminated path buffer.
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

        // `add_directory::<true>` so the `WatchItem` owns its path: the watcher
        // retains the path until eviction runs (deferred onto `evict_list` and
        // drained later in `flush_evictions`), but `dir_name_to_watch` is a
        // transient `dirname()` view of a thread-local path buffer. A borrowed
        // (`::<false>`) `Cow` would dangle once `insert` returns — well before
        // the watcher reads it on a file event. Owning the copy also lets the
        // map keep its own boxed key independently, so no extra intermediate
        // `Box` is needed here.
        let watch_index = match watcher.add_directory::<true>(
            fd,
            dir_name_to_watch,
            bun_watcher::Watcher::get_hash(dir_name_to_watch),
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
            self.dependencies.push(dep);
            index
        }
    }

    /// Removes all dependencies whose `source_file_path` is the exact slice
    /// `file_path`, compared by *pointer identity* since the slice is shared
    /// with `IncrementalGraph.bundled_files`. Called before IncrementalGraph
    /// frees a file's key string so no `Dep` is left holding a dangling pointer.
    pub(crate) fn remove_dependencies_for_file(
        &mut self,
        watcher: &mut bun_watcher::Watcher,
        file_path: &[u8],
    ) {
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
            // Note: reshaped for borrowck — cannot hold &mut entry across
            // self.free_dependency_index(); walk by index and re-borrow.
            let mut new_chain: Option<u32> = None;
            let mut it: Option<u32> = Some(self.watches.values()[watch_index].first_dep);
            while let Some(index) = it {
                let dep_next = self.dependencies[index as usize].next;
                let dep_path = self.dependencies[index as usize].source_file_path;
                it = dep_next;
                // Pointer-identity comparison.
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
                self.free_entry(watcher, watch_index);
            }
        }
    }
}
