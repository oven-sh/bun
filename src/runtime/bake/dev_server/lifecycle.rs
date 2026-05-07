//! Un-gated bodies for `DevServer::{init, start_async_bundle, finalize_bundle}`
//! and the request-handling entry points (`on_request`, `on_asset_request`,
//! `respond_for_html_bundle`).
//!
//! These were previously stubbed in `mod.rs` pending `bun_bundler::BundleV2`
//! field access; the bundler workflow has since un-gated the `BundleV2<'a>`
//! struct shape, so the lifecycle is now real. Hot-update tracing, chunk
//! receipt into `IncrementalGraph`, and the framework-route SSR path remain
//! in the gated Phase-A draft `../DevServer.rs` (blocked on
//! `bun_bundler::Chunk` field access + jsc method surface).

// `feature = "bake_debugging_features"` is not yet a declared cargo feature; the
// struct field gate must mirror `mod.rs` so the initializer below stays in sync.
#![allow(unexpected_cfgs)]

use core::mem::MaybeUninit;
use core::sync::atomic::Ordering;
use std::sync::OnceLock;

use bun_collections::HiveArray;
use bun_logger::Log;
use bun_safety::ThreadLock;

use super::framework_router::FrameworkRouter;
use super::jsc;
use super::{
    deferred_request, route_bundle, Assets, CurrentBundle, DeferredPromise, DevServer,
    DirectoryWatchStore, EntryPointList, EventLoopTimer, HTMLRouter,
    HotReloadEvent, IncrementalGraph, IncrementalResult, Magic, NextBundle, Options, PluginState,
    SourceMapStore, TestingBatchEvents, TimerTag, WatcherAtomics,
};

// ──────────────────────────────────────────────────────────────────────────
// WatcherContext impl — wires `bun_watcher::Watcher::init::<DevServer>`.
// Full bodies (`HotReloadEvent` accumulation, debouncing, event-loop dispatch)
// live in the gated `../DevServer/HotReloadEvent.rs` draft. These trampolines
// give `Watcher::init` a valid vtable so `init()` below is real.
// ──────────────────────────────────────────────────────────────────────────
impl bun_watcher::WatcherContext for DevServer {
    fn on_file_update(
        &mut self,
        _events: &mut [bun_watcher::WatchEvent],
        _changed_files: &[bun_watcher::ChangedFilePath],
        _watchlist: &bun_watcher::WatchList,
    ) {
        // TODO(b2): port `HotReloadEvent::on_file_update` — accumulates into
        // `watcher_atomics.events[]` then enqueues a `ConcurrentTask`.
    }
    fn on_error(&mut self, err: bun_sys::Error) {
        bun_core::Output::warn(format_args!("DevServer watcher error: {err}"));
    }
}


impl WatcherAtomics {
    /// DevServer.zig `WatcherAtomics.init`.
    pub(crate) fn init(owner: *const DevServer) -> Self {
        let mk_event = || HotReloadEvent::init_empty(owner);
        WatcherAtomics {
            events: [mk_event(), mk_event(), mk_event()],
            next_event: core::sync::atomic::AtomicU8::new(super::NextEvent::DONE.0),
            current_event: None,
            pending_event: None,
            #[cfg(debug_assertions)]
            dbg_watcher_event: None,
            #[cfg(debug_assertions)]
            dbg_server_event: None,
        }
    }
}


/// Parse a 16-char hex slice into a `u64` via native-endian byte
/// reinterpretation. Mirrors DevServer.zig:961-965 exactly:
/// `std.fmt.hexToBytes(&out, slice)` then `@bitCast([8]u8 → u64)` — i.e.
/// pairwise hex-decode into `[u8;8]` then `from_ne_bytes`, NOT a big-endian
/// numeric accumulator. Input `"0100000000000000"` → 1 on little-endian.
pub fn parse_hex_to_u64(slice: &[u8]) -> Option<u64> {
    if slice.len() != 16 {
        return None;
    }
    let mut out = [0u8; 8];
    for i in 0..8 {
        let hi = hex_nibble(slice[i * 2])?;
        let lo = hex_nibble(slice[i * 2 + 1])?;
        out[i] = (hi << 4) | lo;
    }
    Some(u64::from_ne_bytes(out))
}

#[inline]
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
