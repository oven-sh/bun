//! `WatcherContext` trait impl for `DevServer` and `WatcherAtomics::init`.
//!
//! `Watcher::init::<DevServer>` dispatches through the generic
//! `WatcherContext` vtable, so the trait methods here are the *only* path the
//! watcher thread reaches — they forward to the inherent
//! `DevServer::{on_file_update, on_watch_error}` bodies in `../DevServer.rs`
//! (ported from `DevServer.zig:4093`/`4153`).

// `feature = "bake_debugging_features"` is not yet a declared cargo feature; the
// struct field gate must mirror `mod.rs` so the initializer below stays in sync.
#![allow(unexpected_cfgs)]

use super::{DevServer, HotReloadEvent, WatcherAtomics};

// ──────────────────────────────────────────────────────────────────────────
// WatcherContext impl — wires `bun_watcher::Watcher::init::<DevServer>`.
// The watcher's stored fn-ptrs (`on_file_update_wrapped` / `on_error_wrapped`
// in `Watcher::init`) call *these* trait methods, never the inherent ones
// directly, so each forwards to the real ported body on `DevServer`.
// ──────────────────────────────────────────────────────────────────────────
impl bun_watcher::WatcherContext for DevServer {
    fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        DevServer::on_file_update(self, events, changed_files, watchlist);
    }

    /// DevServer.zig only defines `onWatchError` (not `onError`); the trait's
    /// default `on_watch_error` would forward here, so route both to the
    /// inherent path-aware impl rather than emitting a generic warn.
    fn on_error(&mut self, err: bun_sys::Error) {
        DevServer::on_watch_error(self, err);
    }

    fn on_watch_error(&mut self, err: bun_sys::Error) {
        DevServer::on_watch_error(self, err);
    }
}

impl WatcherAtomics {
    /// DevServer.zig `WatcherAtomics.init`.
    pub(crate) fn init(owner: *mut DevServer) -> Self {
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
