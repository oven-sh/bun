//! What the watcher thread does for a `DevServer`.

use super::DevServer;
use super::*;

/// What `bun_watcher::Watcher` calls back with, on its thread. It reaches single fields of the
/// `DevServer` and never borrows the whole, which the JS thread does and which is `!Sync`.
pub(crate) struct WatchContext {
    dev: *mut DevServer,
}

impl WatchContext {
    /// # Safety
    /// Whenever a `Watcher` calls this back, `dev` is a live, initialized `DevServer` and that
    /// `Watcher` is its `bun_watcher`.
    pub(super) unsafe fn new(dev: *mut DevServer) -> Self {
        Self { dev }
    }
}

impl bun_watcher::WatcherContext for WatchContext {
    fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        let dev = self.dev;
        // SAFETY: the server is live (contract of `new`). `magic` and `watcher_atomics` are not
        // written between `init` and `Drop`.
        let atomics = unsafe {
            debug_assert!((*dev).magic == Magic::Valid);
            (*dev).watcher_atomics.as_ptr()
        };
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

        // SAFETY: `atomics` is the heap `WatcherAtomics`; watcher thread holds
        // `Watcher.mutex`. The returned slot is exclusive on this thread and
        // is deref'd per-access below (no long-lived `&mut`).
        let ev_ptr = unsafe { WatcherAtomics::watcher_acquire_event(atomics) };
        let ev_ptr_defer: *mut HotReloadEvent = ev_ptr;
        scopeguard::defer! {
            // SAFETY: `atomics`/`ev_ptr_defer` are live for the fn body; guard
            // runs at scope exit with `Watcher.mutex` still held.
            unsafe { WatcherAtomics::watcher_release_and_submit_event(atomics, ev_ptr_defer) }
        };

        let dev_defer = dev;
        // SAFETY: the server is live; only `bun_watcher` is borrowed, under `Watcher.mutex`.
        scopeguard::defer! { unsafe { (*dev_defer).bun_watcher.flush_evictions() } };

        for event in events.iter() {
            // TODO: why does this out of bounds when you delete every file in the directory?
            if event.index as usize >= file_paths.len() {
                continue;
            }

            let file_path = &file_paths[event.index as usize];
            // SAFETY: `counts` is a disjoint SoA column owned by `watchlist`
            // (see above); accesses are statement-scoped.
            let update_count = unsafe { (*counts)[event.index as usize] } + 1;
            // SAFETY: as above.
            unsafe { (*counts)[event.index as usize] = update_count };
            let kind = kinds[event.index as usize];

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
                        // SAFETY: as `flush_evictions` above.
                        unsafe {
                            (*dev).bun_watcher.remove_at_index::<false>(
                                bun_watcher::Kind::File,
                                event.index,
                                0,
                                &[],
                            );
                        }
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

    fn on_error(&mut self, err: sys::Error) {
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
