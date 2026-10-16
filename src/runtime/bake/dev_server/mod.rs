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

use core::sync::atomic::Ordering;

use bun_collections::{HashMap, StringArrayHashMap, bit_set::DynamicBitSet};
use bun_sys::FdExt as _;

use super::jsc;
use super::{Graph, Side};

// ─── submodules ──────────────────────────────────────────────────────────────
pub(crate) mod error_report_request;
pub(crate) mod hmr_socket;
mod js_escape;
pub(crate) mod memory_cost;
mod bundler_vtable;
pub(crate) mod directory_watch_store;
mod hot_reload_event;
mod protocol;
mod watch;
mod watcher_atomics;

pub(crate) use directory_watch_store::DirectoryWatchStore;
pub(crate) use hot_reload_event::HotReloadEvent;
pub(crate) use protocol::{ConsoleLogKind, HmrTopic, IncomingMessageId, MessageId};
pub(crate) use watcher_atomics::{NextEvent, WatcherAtomics};

// NOTE: the `DevServer` scoped-log static (`ScopedLogger`) is declared in
// `dev_server_body` (`bun_output::declare_scope!(DevServer, visible)`) and
// re-exported via the `pub use` block below alongside the `struct DevServer`
// type. Declaring it again here would collide in the value namespace.

pub(crate) const ASSET_PREFIX: &str = "/_bun/asset";
pub(crate) const CLIENT_PREFIX: &str = "/_bun/client";

// LAYERING: the 4.8 kL of method bodies live in `../DevServer.rs` (mounted as
// `super::dev_server_body`). The struct definitions are owned there so impl
// blocks and `container_of` submodules name a single type. Re-export so
// `crate::bake::dev_server::DevServer` (the public path used by `server/`,
// `dispatch.rs`, …) resolves to that one struct.
pub(crate) use super::dev_server_body::{
    DevServer, EntryPointList, Magic, Options, RouteIndexAndRecurseFlag, TestingBatchEvents,
    deferred_request,
};

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
    pub(crate) subscriptions: super::dev_server_body::HmrTopicBits,
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
