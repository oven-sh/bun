//! `WatcherContext` trait impl for `DevServer` and `WatcherAtomics::init`.
//!
//! `Watcher::init::<DevServer>` dispatches through the generic
//! `WatcherContext` vtable, so the trait methods here are the *only* path the
//! watcher thread reaches — they forward to the inherent
//! `DevServer::{on_file_update, on_watch_error}` bodies in `../DevServer.rs`.

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

    /// The trait's default `on_watch_error` would forward here, so route both
    /// to the inherent path-aware impl rather than emitting a generic warn.
    fn on_error(&mut self, err: bun_sys::Error) {
        DevServer::on_watch_error(self, err);
    }

    fn on_watch_error(&mut self, err: bun_sys::Error) {
        DevServer::on_watch_error(self, err);
    }
}

impl WatcherAtomics {
    pub(crate) fn init(owner: *mut DevServer) -> Box<Self> {
        let mk_event = || HotReloadEvent::init_empty(owner);
        let mut boxed = Box::new(WatcherAtomics {
            events: [mk_event(), mk_event(), mk_event()],
            next_event: core::sync::atomic::AtomicU8::new(super::NextEvent::DONE.0),
            current_event: None,
            pending_event: None,
            #[cfg(debug_assertions)]
            dbg_watcher_event: None,
            #[cfg(debug_assertions)]
            dbg_server_event: None,
        });
        // Back-fill each event's BACKREF to this allocation once the Box
        // address is stable. All access goes through the one raw pointer so
        // Stacked Borrows sees a single Unique-derived tag.
        let atomics: *mut WatcherAtomics = &raw mut *boxed;
        // SAFETY: `atomics` was just derived from `boxed`; the whole
        // allocation is exclusively reachable through it here.
        unsafe {
            for ev in &mut (*atomics).events {
                ev.atomics = atomics;
            }
        }
        boxed
    }
}
