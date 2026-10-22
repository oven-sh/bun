//! `WatcherContext` trait impl for `DevServer`.
//!
//! `Watcher::init::<DevServer>` dispatches through the generic
//! `WatcherContext` vtable, so the trait methods here are the *only* path the
//! watcher thread reaches — they forward to the inherent
//! `DevServer::{on_file_update, on_watch_error}` bodies below.

use super::DevServer;
use super::*;

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

impl DevServer {
    /// Called on watcher's thread; Access to dev-server state restricted.
    pub(crate) fn on_file_update(
        &mut self,
        events: &[bun_watcher::Event],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        debug_assert!(self.magic == Magic::Valid);
        debug_log!("onFileUpdate start");
        scopeguard::defer! { debug_log!("onFileUpdate end") };

        let mut slice = watchlist.slice();
        // Note: SoA columns are disjoint, but `items_mut` borrows the whole
        // slice mutably. Erase each column to a raw `*mut [T]` and reborrow at
        // the use sites — the columns never alias (per `MultiArrayElement` layout).
        let file_paths: *const [std::borrow::Cow<'static, [u8]>] = slice.items_file_path();
        // SAFETY: column 4 (`Count`) is `u32` per `WatchItemField`.
        let counts: *mut [u32] = slice.items_mut::<"count", u32>();
        let kinds: *const [bun_watcher::Kind] = slice.items_kind();
        // SAFETY: `file_paths`/`kinds`/`counts` point to disjoint SoA columns owned
        // by `watchlist`, which outlives this fn; reborrow the shared ones as
        // slices for indexing (`counts` stays raw, deref'd per-access below).
        let file_paths = unsafe { &*file_paths };
        // SAFETY: see above; `kinds` is a disjoint SoA column owned by `watchlist`.
        let kinds = unsafe { &*kinds };

        let atomics = self.watcher_atomics.as_ptr();
        // SAFETY: `atomics` is the heap `WatcherAtomics`; watcher thread holds
        // `Watcher.mutex`. The returned slot is exclusive on this thread and
        // is deref'd per-access below (no long-lived `&mut`).
        let ev_ptr = unsafe { WatcherAtomics::watcher_acquire_event(atomics) };
        // Note: erase `self` to a raw ptr in the deferred closures so the
        // loop body can keep using `self.bun_watcher`.
        let self_ptr: *mut Self = self;
        let ev_ptr_defer: *mut HotReloadEvent = ev_ptr;
        scopeguard::defer! {
            // SAFETY: `atomics`/`ev_ptr_defer` are live for the fn body; guard
            // runs at scope exit with `Watcher.mutex` still held.
            unsafe { WatcherAtomics::watcher_release_and_submit_event(atomics, ev_ptr_defer) }
        };

        // SAFETY: see `self_ptr` SAFETY above.
        scopeguard::defer! { unsafe { (*self_ptr).bun_watcher.flush_evictions() } };

        for event in events {
            let event_index = event.index.get_usize();
            // TODO: why does this out of bounds when you delete every file in the directory?
            if event_index >= file_paths.len() {
                continue;
            }

            let file_path = &file_paths[event_index];
            // SAFETY: `counts` is a disjoint SoA column owned by `watchlist`
            // (see above); accesses are statement-scoped.
            let update_count = unsafe { (*counts)[event_index] } + 1;
            // SAFETY: as above.
            unsafe { (*counts)[event_index] = update_count };
            let kind = kinds[event_index];

            debug_log!(
                "{} change: {} {}",
                match kind {
                    bun_watcher::Kind::File => "file",
                    bun_watcher::Kind::Directory => "directory",
                },
                bstr::BStr::new(file_path),
                event.op
            );

            match kind {
                bun_watcher::Kind::File => {
                    if event.op.contains(bun_watcher::Op::DELETE)
                        || event.op.contains(bun_watcher::Op::RENAME)
                    {
                        // TODO: audit this line heavily
                        self.bun_watcher.remove_at_index::<false>(event.index);
                    }

                    // SAFETY: `ev_ptr` is this thread's exclusively-acquired
                    // slot (see above); the borrow ends with this call.
                    unsafe { &mut *ev_ptr }.append_file(file_path);
                }
                bun_watcher::Kind::Directory => {
                    // Note: `target_os = "linux"` is false on Android, so
                    // include `target_os = "android"` explicitly to
                    // keep forwarding inotify sub-path names there.
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    {
                        // INotifyWatcher stores sub paths into `changed_files`
                        let names = event.names(changed_files);
                        if !names.is_empty() {
                            for maybe_sub_path in names {
                                // SAFETY: see `ev_ptr` above; call-scoped borrow.
                                unsafe { &mut *ev_ptr }
                                    .append_dir(file_path, maybe_sub_path.map(|s| s.as_bytes()));
                            }
                        } else {
                            // SAFETY: see `ev_ptr` above; call-scoped borrow.
                            unsafe { &mut *ev_ptr }.append_dir(file_path, None);
                        }
                    }
                    #[cfg(not(any(target_os = "linux", target_os = "android")))]
                    {
                        let _ = changed_files;
                        // SAFETY: see `ev_ptr` above; call-scoped borrow.
                        unsafe { &mut *ev_ptr }.append_dir(file_path, None);
                    }
                }
            }
        }
    }

    pub(crate) fn on_watch_error(&self, err: sys::Error) {
        if !err.path.is_empty() {
            // Note: split out path before moving `err` into `Output::err`.
            let path = err.path.clone();
            Output::err(
                err,
                "failed to watch {} for hot-reloading",
                (bun_core::fmt::quote(&path),),
            );
        } else {
            Output::err(err, "failed to watch files for hot-reloading", ());
        }
        bun_core::warn!(
            "The development server is still running, but hot-reloading is disabled until a restart.",
        );
        // TODO: attempt to automatically restart the watcher thread, perhaps wait for next request.
    }
}
